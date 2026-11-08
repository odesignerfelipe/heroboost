'use strict';
const initialSettings = [
  { id: 'game-mode', name: 'Modo de Jogo do Windows', category: 'Desempenho', description: 'Ativa a preferência nativa de Modo de Jogo do Windows para a sua conta.', path: 'Software\\Microsoft\\GameBar', value: 'AutoGameModeEnabled', kind: 'DWord', target: 1 },
  { id: 'capture', name: 'Captura em segundo plano', category: 'Desempenho', description: 'Desativa a captura de jogos da Xbox Game Bar. Gravações com OBS continuam independentes.', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', value: 'AppCaptureEnabled', kind: 'DWord', target: 0 },
  { id: 'dvr', name: 'Gravação de jogos (Game DVR)', category: 'Desempenho', description: 'Desliga a preferência de gravação Game DVR da sua conta. Pode exigir sair da sessão.', path: 'System\\GameConfigStore', value: 'GameDVR_Enabled', kind: 'DWord', target: 0 },
  { id: 'transparency', name: 'Efeitos de transparência', category: 'Visual', description: 'Reduz efeitos translúcidos da interface. O Windows pode aplicar após entrar novamente.', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', value: 'EnableTransparency', kind: 'DWord', target: 0 },
  { id: 'animations', name: 'Animações de janelas', category: 'Visual', description: 'Reduz animações ao minimizar e maximizar. Exige sair e entrar na sessão.', path: 'Control Panel\\Desktop\\WindowMetrics', value: 'MinAnimate', kind: 'String', target: '0' },
  { id: 'advertising', name: 'Identificador de publicidade', category: 'Privacidade', description: 'Desativa o uso do identificador de publicidade por aplicativos nesta conta.', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', value: 'Enabled', kind: 'DWord', target: 0 },
  { id: 'suggestions', name: 'Sugestões no menu Iniciar', category: 'Privacidade', description: 'Desativa uma categoria de sugestões de conteúdo do Windows. A disponibilidade varia por versão.', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', value: 'SubscribedContent-338388Enabled', kind: 'DWord', target: 0 },
  { id: 'tips', name: 'Dicas e recomendações', category: 'Privacidade', description: 'Desativa dicas de uso distribuídas pelo Windows para esta conta.', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', value: 'SubscribedContent-338389Enabled', kind: 'DWord', target: 0 },
  { id: 'tailored', name: 'Experiências personalizadas', category: 'Privacidade', description: 'Desativa a preferência de recomendações personalizadas baseadas em dados de diagnóstico.', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Privacy', value: 'TailoredExperiencesWithDiagnosticDataEnabled', kind: 'DWord', target: 0 }
];
const profiles = [
  {id:'balanced', name:'Equilibrado', icon:'balance', tag:'PARA O DIA A DIA', description:'Trabalho, estudo e uma partida no fim do dia.', settings:['game-mode','advertising','suggestions','tips','tailored'], color:'green'},
  {id:'competitive', name:'Competitivo', icon:'crosshair', tag:'FOCO NA PARTIDA', description:'Menos efeitos e captura em segundo plano.', settings:['game-mode','capture','dvr','transparency','animations','advertising','tips'], color:'purple'},
  {id:'creator', name:'Criador', icon:'pen', tag:'IDEIAS EM MOVIMENTO', description:'Edição, 3D e projetos com menos distrações.', settings:['transparency','advertising','suggestions','tips','tailored'], color:'blue'},
  {id:'streamer', name:'Streamer', icon:'broadcast', tag:'SUA LIVE EM PRIMEIRO', description:'Desliga a captura do Windows para usar seu OBS.', settings:['game-mode','capture','dvr','advertising','tips'], color:'pink'},
  {id:'laptop', name:'Notebook', icon:'laptop', tag:'LEVE ONDE FOR', description:'Ajustes leves, sem forçar energia ou aquecimento.', settings:['transparency','advertising','suggestions','tips'], color:'orange'},
  {id:'modest', name:'PC Modesto', icon:'chip', tag:'CADA RECURSO CONTA', description:'Reduz efeitos e recursos de gravação de jogos.', settings:['capture','dvr','transparency','animations','advertising','tips'], color:'blue'},
  {id:'privacy', name:'Privacidade', icon:'shield', tag:'SEUS DADOS, SUAS REGRAS', description:'Menos publicidade e recomendações personalizadas.', settings:['advertising','suggestions','tips','tailored'], color:'purple'}
];
const settings=require('../native/settings.json');
const everyday=['game-mode','advertising','suggestions','tips','tailored','silent-apps','soft-landing','settings-content','sync-notifications','feedback-frequency','search-highlights','edge-start','edge-background'];
for(const p of profiles){
  const extra=p.id==='privacy'?everyday.filter(id=>id!=='game-mode').concat(['search-web','typing-collection','ink-collection','clipboard-cloud']):everyday;
  p.settings=[...new Set([...p.settings,...extra])];
  if(p.id==='competitive'||p.id==='modest')p.settings.push('taskbar-animations','peek','drag-content');
  if(p.id==='laptop')p.settings=p.settings.filter(id=>id!=='game-mode');
  p.color=p.color==='green'?'orange':p.color;
}
profiles.push({id:'hero',name:'Hero Completo',icon:'shield',tag:'REVISE CADA AJUSTE',description:'Conjunto amplo de privacidade, interface e apps. Sem bloquear câmera, microfone ou proteções.',color:'orange',settings:settings.filter(s=>s.hive==='HKCU'&&s.risk==='low'&&s.category!=='Permissões de apps'&&!['Interface','IA do Windows'].includes(s.category)&&s.id!=='font-smoothing').map(s=>s.id)});
function support(spec,info){
  const build=Number(info?.build||0);
  if(build&&build<spec.minBuild)return 'Requer uma versão mais recente do Windows.';
  if(spec.maxBuild&&build>spec.maxBuild)return 'Preferência legada, fora da faixa de compatibilidade.';
  if(spec.policy&&info?.edition==='Core')return 'Esta política requer edição Pro, Enterprise ou Education.';
  return null;
}
module.exports = { settings, profiles, support };
