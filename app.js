// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let isRecording = false;
let captureMode = 'mic';   // 'mic' | 'system'
let recognition = null;    // Web Speech API (mic mode)
let shouldRestart = false;
let mediaRecorder = null;    // MediaRecorder (system mode)
let displayStream = null;    // getDisplayMedia stream
let audioChunks = [];
let chunkTimer = null;
let fullTranscript = '';
let wordBuffer = '';
let analyzeTimer = null;
let speakInterval = null;
let speakSeconds = 0;
let isAnalyzing = false;
let profile = {};
let interimEl = null;

// ═══════════════════════════════════════════════════════════════
// PROFILE PERSISTENCE
// ═══════════════════════════════════════════════════════════════
function loadProfile() {
  try {
    const s = localStorage.getItem('coach-profile');
    if (!s) return;
    const p = JSON.parse(s);
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set('f-nome', p.nome);
    set('f-cargo-atual', p.cargoAtual);
    set('f-cargo-alvo', p.cargoAlvo);
    set('f-conquistas', p.conquistas);
    set('f-experiencias', p.experiencias);
    set('f-habilidades', p.habilidades);
    set('f-destaques', p.destaques);
    set('f-entrev-nome', p.entrevNome);
    set('f-entrev-background', p.entrevBackground);
    set('f-entrev-estilo', p.entrevEstilo);
    set('f-entrev-raw', p.entrevRaw);
    set('f-openai-key', p.openaiKey);
    set('f-notas', p.notas);
    set('f-case', p.caseInfo);
    set('f-business', p.business);
    set('f-target-business', p.targetBusiness);
  } catch (e) { }
}

function saveProfile() {
  const g = id => document.getElementById(id)?.value || '';
  profile = {
    nome: g('f-nome'), cargoAtual: g('f-cargo-atual'), cargoAlvo: g('f-cargo-alvo'),
    conquistas: g('f-conquistas'), experiencias: g('f-experiencias'),
    habilidades: g('f-habilidades'), destaques: g('f-destaques'),
    entrevNome: g('f-entrev-nome'), entrevBackground: g('f-entrev-background'),
    entrevEstilo: g('f-entrev-estilo'), entrevRaw: g('f-entrev-raw'),
    openaiKey: g('f-openai-key'),
    notas: g('f-notas'),
    caseInfo: g('f-case'),
    business: g('f-business'),
    targetBusiness: g('f-target-business'),
  };
  try { localStorage.setItem('coach-profile', JSON.stringify(profile)); } catch (e) { }
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════
function goToInterview() {
  saveProfile();
  document.getElementById('screen-setup').classList.remove('active');
  document.getElementById('screen-interview').classList.add('active');
}
function goToSetup() {
  if (isRecording) stopRecording();
  document.getElementById('screen-interview').classList.remove('active');
  document.getElementById('screen-setup').classList.add('active');
}

// ═══════════════════════════════════════════════════════════════
// MODE TOGGLE
// ═══════════════════════════════════════════════════════════════
function selectMode(mode) {
  if (isRecording) return;
  captureMode = mode;
  document.getElementById('btn-mode-mic').className = 'mode-btn mic' + (mode === 'mic' ? ' selected' : '');
  document.getElementById('btn-mode-system').className = 'mode-btn system' + (mode === 'system' ? ' selected' : '');
  const btn = document.getElementById('btn-record');
  btn.className = 'btn-record ' + (mode === 'mic' ? 'start-mic' : 'start-system');
}

// ═══════════════════════════════════════════════════════════════
// TYPE CONFIG
// ═══════════════════════════════════════════════════════════════
const TYPE_CFG = {
  stop: { icon: '🛑', label: 'PARE AGORA', color: 'stop' },
  focus: { icon: '🎯', label: 'FOCO', color: 'focus' },
  suggest: { icon: '💡', label: 'SUGESTÃO', color: 'suggest' },
  praise: { icon: '✅', label: 'ÓTIMO', color: 'praise' },
  summary: { icon: '✏️', label: 'RESUMO', color: 'summary' },
  topic: { icon: '📌', label: 'TÓPICO', color: 'topic' },
  time: { icon: '⏱️', label: 'TEMPO', color: 'time' },
  system: { icon: '⚙️', label: 'SISTEMA', color: 'system' },
};

// ═══════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════
function addMessage(type, message, urgency) {
  const area = document.getElementById('messages-area');
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();
  const cfg = TYPE_CFG[type] || TYPE_CFG.system;
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const card = document.createElement('div');
  card.className = `coach-card type-${cfg.color}`;
  card.innerHTML = `
    <div class="card-header">
      <span class="card-type color-${cfg.color}">${cfg.icon} ${cfg.label}</span>
      <span class="card-time">${time}</span>
    </div>
    <div class="card-msg">${esc(message)}</div>
  `;
  area.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function updateInterim(text) {
  const area = document.getElementById('messages-area');
  if (!interimEl) { interimEl = document.createElement('div'); interimEl.className = 'transcript-bubble'; area.appendChild(interimEl); }
  interimEl.innerHTML = `<span class="speaker me">VOCÊ (ao vivo)</span>${esc(text)}`;
  interimEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
}
function clearInterim() { if (interimEl) { interimEl.remove(); interimEl = null; } }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════
function buildSystemPrompt(p) {
  const hasInterviewer = p.entrevNome || p.entrevBackground || p.entrevEstilo || p.entrevRaw;
  const iblock = hasInterviewer ? `
PERFIL DO ENTREVISTADOR:
- Nome/cargo: ${p.entrevNome || 'não informado'}
- Background: ${p.entrevBackground || 'não informado'}
- Estilo/interesses: ${p.entrevEstilo || 'não informado'}
- Texto bruto: ${p.entrevRaw || 'não informado'}

Como usar: se técnico → sugira profundidade técnica; se gestor → foque em impacto; se gosta de IA/dados → proponha isso; adapte linguagem ao que ele valoriza.
` : '';

  const businessLine  = p.business       ? `- Produto atual: ${p.business}` : '';
  const targetBizLine = p.targetBusiness  ? `- Produto alvo: ${p.targetBusiness}` : '';
  const caseBlock     = p.caseInfo        ? `\nCASE APRESENTADO NO PROCESSO SELETIVO:\n${p.caseInfo}\n\nQuando o entrevistador perguntar sobre o case: sugira mencionar os trade-offs, os serviços AWS escolhidos, o padrão cell-based, o uso de IU Pipes e Datadog. Incentive usar a frase-âncora sobre trade-offs quando apropriado.` : '';

  return `Você é um coach de entrevistas em tempo real, especializado em apoiar pessoas com autismo e TDAH.

CANDIDATO:
- Nome: ${p.nome || 'candidato'}
- Cargo atual: ${p.cargoAtual}${businessLine ? '\n' + businessLine : ''}
- Cargo desejado: ${p.cargoAlvo}${targetBizLine ? '\n' + targetBizLine : ''}
- Conquistas: ${p.conquistas || 'não informado'}
- Experiências: ${p.experiencias || 'não informado'}
- Habilidades: ${p.habilidades || 'não informado'}
- Destaques: ${p.destaques || 'não informado'}
- Contexto especial: ${p.notas}
${iblock}${caseBlock}
MISSÃO: Analisar a transcrição e retornar UMA instrução curta, direta e encorajadora.
No modo Sistema/Teams a transcrição inclui os dois lados: use isso para sugerir respostas alinhadas ao que o entrevistador perguntou.

RESPONDA APENAS COM JSON VÁLIDO (sem markdown):
{"type":"stop"|"focus"|"suggest"|"praise"|"summary"|"topic"|"none","message":"instrução em até 20 palavras","urgency":"low"|"medium"|"high"}

QUANDO USAR:
- stop: repetindo ou já respondeu bem → "Conclua agora! Você explicou muito bem."
- focus: desviando do assunto → "Volte ao foco: [dica específica]"
- suggest: hora de mencionar algo do perfil → "Mencione: [conquista/experiência]"
- praise: fez ponto excelente → "Perfeito! Esse ponto foi ótimo."
- summary: confuso ou longo → "Tente resumir: [frase curta]"
- topic: abrir assunto relevante → "Seria bom falar sobre: [tópico]"
- none: indo bem, sem necessidade de intervenção

Seja encorajador. Nunca critique negativamente. Linguagem simples e direta.`;
}

// ═══════════════════════════════════════════════════════════════
// COACHING API (Claude)
// ═══════════════════════════════════════════════════════════════
async function analyzeTranscript() {
  const buffer = wordBuffer.trim();
  if (!buffer || isAnalyzing) return;
  wordBuffer = '';
  isAnalyzing = true;
  document.getElementById('analyzing-badge').style.display = 'inline';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: buildSystemPrompt(profile),
        messages: [{ role: 'user', content: `Transcrição da sessão:\n${fullTranscript}\n\nÚltimo trecho:\n"${buffer}"\n\nRetorne o JSON.` }]
      })
    });
    const data = await resp.json();
    const raw = (data.content || []).find(b => b.type === 'text')?.text || '';
    const coaching = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (coaching.type && coaching.type !== 'none') addMessage(coaching.type, coaching.message, coaching.urgency);
  } catch (e) { }
  finally {
    isAnalyzing = false;
    document.getElementById('analyzing-badge').style.display = 'none';
  }
}

function scheduleAnalysis() {
  clearTimeout(analyzeTimer);
  const words = wordBuffer.trim().split(/\s+/).length;
  analyzeTimer = setTimeout(analyzeTranscript, words > 35 ? 1500 : 4000);
}

// ═══════════════════════════════════════════════════════════════
// WHISPER TRANSCRIPTION
// ═══════════════════════════════════════════════════════════════
async function transcribeChunk(blob) {
  const key = profile.openaiKey;
  if (!key) { addMessage('system', 'Chave OpenAI não configurada. Vá em Perfil e adicione a chave.', 'high'); return; }
  try {
    const fd = new FormData();
    fd.append('file', blob, 'chunk.webm');
    fd.append('model', 'whisper-1');
    fd.append('language', 'pt');
    fd.append('response_format', 'text');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: fd
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 401) addMessage('system', 'Chave OpenAI inválida. Verifique em Perfil.', 'high');
      return;
    }
    const text = (await resp.text()).trim();
    if (!text) return;
    fullTranscript += text + ' ';
    wordBuffer += text + ' ';
    scheduleAnalysis();
    // Show brief transcript bubble
    if (interimEl) { interimEl.remove(); interimEl = null; }
    const area = document.getElementById('messages-area');
    const bub = document.createElement('div');
    bub.className = 'transcript-bubble';
    bub.innerHTML = `<span class="speaker me">TRANSCRIÇÃO</span>${esc(text)}`;
    area.appendChild(bub);
    bub.scrollIntoView({ behavior: 'smooth', block: 'end' });
    // Fade out after 8s
    setTimeout(() => { bub.style.transition = 'opacity 1s'; bub.style.opacity = '0'; setTimeout(() => bub.remove(), 1000); }, 8000);
  } catch (e) { }
}

function flushChunk() {
  if (!audioChunks.length) return;
  const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
  audioChunks = [];
  if (blob.size > 1000) transcribeChunk(blob); // ignore tiny/silent chunks
}

// ═══════════════════════════════════════════════════════════════
// SPEAK TIMER
// ═══════════════════════════════════════════════════════════════
function startSpeakTimer() {
  speakSeconds = 0;
  speakInterval = setInterval(() => {
    speakSeconds++;
    updateSpeakTimer();
    if (speakSeconds === 90) addMessage('time', '1 minuto e meio! Comece a concluir sua resposta.', 'high');
    if (speakSeconds === 120) addMessage('stop', '2 minutos! Encerre com uma frase curta e objetiva.', 'high');
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
// RECORDING — MIC MODE (Web Speech API)
// ═══════════════════════════════════════════════════════════════
function startMicMode() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { addMessage('system', '⚠️ Use Chrome ou Edge no Windows para o modo microfone.', 'high'); return false; }
  recognition = new SR();
  recognition.lang = 'pt-BR';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => { isRecording = true; updateUI(); };
  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t + ' '; else interim += t;
    }
    if (final) { fullTranscript += final; wordBuffer += final; clearInterim(); scheduleAnalysis(); }
    else if (interim) updateInterim(interim);
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') { addMessage('system', 'Microfone bloqueado. Clique no cadeado na barra de endereço e permita.', 'high'); shouldRestart = false; stopRecording(); }
    else if (e.error !== 'no-speech' && e.error !== 'aborted') addMessage('system', `Erro: ${e.error}`, 'medium');
  };
  recognition.onend = () => { if (shouldRestart) { try { recognition.start(); } catch (e) { } } };
  shouldRestart = true;
  try { recognition.start(); return true; } catch (e) { addMessage('system', 'Não foi possível iniciar. Verifique o microfone.', 'high'); return false; }
}

// ═══════════════════════════════════════════════════════════════
// RECORDING — SYSTEM MODE (getDisplayMedia + Whisper)
// ═══════════════════════════════════════════════════════════════
async function startSystemMode() {
  if (!profile.openaiKey) {
    addMessage('system', 'Chave OpenAI necessária para o modo Sistema. Configure em Perfil.', 'high');
    return false;
  }
  try {
    // Request screen share WITH system audio
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },   // video obrigatório no Chrome para liberar audio
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 16000,
        systemAudio: 'include'   // Chrome flag (quando disponível)
      }
    });
  } catch (e) {
    if (e.name === 'NotAllowedError') addMessage('system', 'Compartilhamento cancelado. Tente novamente e selecione a janela do Teams.', 'medium');
    else addMessage('system', `Erro ao capturar tela: ${e.message}`, 'high');
    return false;
  }

  const audioTracks = displayStream.getAudioTracks();
  if (!audioTracks.length) {
    addMessage('system', '⚠️ Nenhum áudio capturado. No Chrome: ao compartilhar, marque "Compartilhar áudio do sistema".', 'high');
    displayStream.getTracks().forEach(t => t.stop());
    displayStream = null;
    return false;
  }

  // Stop video track immediately — we only need audio
  displayStream.getVideoTracks().forEach(t => t.stop());

  const audioStream = new MediaStream(audioTracks);

  // Optionally mix in microphone too
  try {
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(audioStream).connect(dest);
    ctx.createMediaStreamSource(micStream).connect(dest);
    mediaRecorder = new MediaRecorder(dest.stream, { mimeType: getSupportedMimeType() });
  } catch (e) {
    // Fallback: system audio only
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: getSupportedMimeType() });
  }

  mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop = () => { };

  // Collect chunks every 5 seconds and transcribe
  mediaRecorder.start(5000);
  chunkTimer = setInterval(() => {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.requestData();
      // Small delay to ensure data is available
      setTimeout(flushChunk, 300);
    }
  }, 5000);

  // Detect if stream ends (user stopped sharing)
  displayStream.getAudioTracks()[0].onended = () => {
    addMessage('system', 'Compartilhamento de áudio encerrado.', 'medium');
    stopRecording();
  };

  isRecording = true;
  updateUI();
  return true;
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// ═══════════════════════════════════════════════════════════════
// TOGGLE
// ═══════════════════════════════════════════════════════════════
async function toggleRecording() {
  if (isRecording) { stopRecording(); return; }
  fullTranscript = ''; wordBuffer = '';
  const ok = captureMode === 'mic' ? startMicMode() : await startSystemMode();
  if (!ok) return;
  startSpeakTimer();
  addMessage('praise', '🍀 Coach ativado! Respire fundo. Você está preparado.', 'low');
  if (captureMode === 'system') {
    addMessage('topic', 'Modo Teams ativo — capturando todos os lados da conversa.', 'low');
  }
}

function stopRecording() {
  shouldRestart = false;
  clearTimeout(analyzeTimer);
  clearInterval(speakInterval);
  clearInterval(chunkTimer);
  try { recognition?.stop(); recognition?.abort(); } catch (e) { }
  if (mediaRecorder?.state !== 'inactive') try { mediaRecorder?.stop(); } catch (e) { }
  if (displayStream) { displayStream.getTracks().forEach(t => t.stop()); displayStream = null; }
  mediaRecorder = null; audioChunks = [];
  isRecording = false;
  clearInterim();
  document.getElementById('speak-timer').style.display = 'none';
  updateUI();
  addMessage('praise', 'Sessão encerrada. Parabéns pela entrevista! 🎉', 'low');
}

function resetSession() {
  if (isRecording) stopRecording();
  const area = document.getElementById('messages-area');
  area.innerHTML = `<div id="empty-state" class="empty-state"><div class="empty-icon">🎙️</div><div class="empty-text">Escolha o modo e toque em <strong>INICIAR</strong>.<br>O coach vai te guiar em tempo real.</div></div>`;
  interimEl = null; fullTranscript = ''; wordBuffer = ''; speakSeconds = 0;
}

// ═══════════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════════
function updateUI() {
  const dot = document.getElementById('rec-dot');
  const label = document.getElementById('rec-label');
  const btn = document.getElementById('btn-record');
  const timer = document.getElementById('speak-timer');
  const modeMic = document.getElementById('btn-mode-mic');
  const modeSystem = document.getElementById('btn-mode-system');
  if (isRecording) {
    dot.classList.add('active');
    label.textContent = 'AO VIVO'; label.classList.add('active');
    btn.textContent = '⏹  PARAR SESSÃO'; btn.className = 'btn-record stop-any';
    timer.style.display = 'flex';
    modeMic.disabled = true; modeSystem.disabled = true;
  } else {
    dot.classList.remove('active');
    label.textContent = 'PARADO'; label.classList.remove('active');
    btn.textContent = '▶  INICIAR SESSÃO';
    btn.className = 'btn-record ' + (captureMode === 'mic' ? 'start-mic' : 'start-system');
    modeMic.disabled = false; modeSystem.disabled = false;
  }
}

function updateSpeakTimer() {
  const m = Math.floor(speakSeconds / 60), s = speakSeconds % 60;
  document.getElementById('timer-display').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const wrap = document.getElementById('speak-timer');
  wrap.className = 'speak-timer ' + (speakSeconds > 90 ? 'danger' : speakSeconds > 60 ? 'warn' : 'ok');
  document.getElementById('timer-alert').style.display = speakSeconds > 90 ? 'inline' : 'none';
}


// ═══════════════════════════════════════════════════════════════
// YAML IMPORT
// ═══════════════════════════════════════════════════════════════
function handleYamlDrop(e) {
  e.preventDefault();
  document.getElementById('yaml-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleYamlFile(file);
}

function handleYamlFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = jsyaml.load(e.target.result);
      applyYamlToForm(data);
      // Show success state
      document.getElementById('yaml-idle').style.display = 'none';
      const ok = document.getElementById('yaml-ok');
      ok.style.display = 'flex';
      document.getElementById('yaml-ok-name').textContent = (data.name || 'Perfil') + ' carregado!';
    } catch (err) {
      alert('Erro ao ler o YAML: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function applyYamlToForm(d) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = String(val).trim();
  };

  set('f-nome', d.name);
  set('f-cargo-atual', d.role);

  if (d.target) {
    const targetRole = [d.target.role, d.target.company].filter(Boolean).join(' — ');
    set('f-cargo-alvo', targetRole || d.target.role);
  }

  if (d.resume) {
    set('f-conquistas', d.resume.achievements);
    set('f-experiencias', d.resume.professional_background || d.resume.profissional_background);
    set('f-habilidades', d.resume.technical_skills);
    set('f-destaques', d.resume.highlights);
  }

  if (d.interviewer) {
    const iName = [d.interviewer.name, d.interviewer.role, d.interviewer.company].filter(Boolean).join(' — ');
    set('f-entrev-nome', iName);
    set('f-entrev-background', d.interviewer.background);
    set('f-entrev-estilo', d.interviewer.style);
    set('f-entrev-raw', d.interviewer.overview || d.interviewer.profile);
  }

  // business fields
  set('f-business', d.business);
  if (d.target) set('f-target-business', d.target.business);

  // context: supports both plain string and object with overview/case
  if (d.context) {
    if (typeof d.context === 'string') {
      set('f-notas', d.context);
    } else {
      set('f-notas', d.context.overview);
      set('f-case', d.context.case);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
loadProfile();