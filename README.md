# Hero Boost 0.2.0

Aplicativo desktop para Windows 10/11 x64. Interface em português com a identidade fornecida: escudo HB, laranja `#FF6A00` / `#FF8A1F`, grafite e azul elétrico `#00D6FF`. Implementação independente, inspirada nas categorias do [Dilera Boost](https://www.dileraboost.com.br/).

## Usar no Windows

Preferencialmente execute **`release/Hero-Boost-0.2.0-Setup.exe`**. O instalador cria atalhos e prepara o canal de atualizações. Alternativa sem instalação: **`release/Hero-Boost-0.2.0-Windows.exe`**. Não é necessário instalar Node.js para usar o aplicativo.

1. Abra o Hero e confira o diagnóstico.
2. Em **Perfis de uso**, revise o perfil adequado à sua máquina. Aplique somente depois de ler as escolhas.
3. Para jogos, trabalho, estudo ou streaming, adicione os executáveis em **Modo foco** e ative o monitoramento.
4. Em **Histórico**, restaure individualmente ou em lote. Arquivos isolados são restaurados pela área de limpeza.

O app inicia com permissões normais. O botão **Abrir como administrador** restaura o foco e solicita o UAC do Windows antes de reiniciar. Drivers, serviços, tarefas, rede e políticas de máquina podem exigir administrador. Recusas do sistema são apresentadas; não são contornadas. O executável de desenvolvimento ainda não possui certificado de assinatura de código.

## Funções implementadas

| Área | Comportamento real | Limites relevantes |
| --- | --- | --- |
| Boost e perfis | 101 preferências distintas; oito perfis, incluindo Criador e Hero Completo; revisão antes de aplicar; backup sincronizado em disco antes de escrever | A lista inclui privacidade e personalização, não 101 ganhos de desempenho. Políticas dependem de edição, build e aplicativo. Não reproduz o perfil JLO, cujo conteúdo integral não consta da referência pública. |
| Modo foco | Caminho exato, PID e início; prioridade Acima do normal ou Alta; segundo plano escolhido pelo usuário desce para Abaixo do normal | Não suspende nem encerra processos. Windows, antivírus e anticheat são excluídos. Programas elevados/protegidos podem negar acesso. |
| Serviços durante foco | Pausa opcional de WSearch e, com SSD detectado, SysMain; restauração do estado original | Exige administrador; pode afetar buscas. Desligado por padrão. Não altera serviços de proteção. |
| Inicialização | Run de HKCU, HKLM e HKLM WOW6432Node; desativação com backup; entradas de segurança protegidas | Atalhos de pastas e tarefas de logon adicionais ficam no painel oficial do Windows. |
| Impacto de login | Eventos 100/101 do Diagnostics-Performance, com tempo e degradação reportados pelo Windows | O log pode estar desabilitado, vazio ou inacessível. Não inventa tempos nem atribui causalidade a cada entrada. |
| Debloat | Lista permitida de apps opcionais; remoção por conta, com tentativa de registro pelo manifesto no histórico | Remoção pode apagar dados. Se o Windows apagar os arquivos do pacote, reinstale pela Store. Não é totalmente reversível. |
| Limpeza | Temporários, cache DirectX/NVIDIA e cache padrão de Chrome, Edge e Brave; análise, quarentena, restauração sem sobrescrever e exclusão separada | Arquivos criados e modificados há mais de 7 dias. Navegador deve estar fechado. Não inclui cookies/credenciais. Shaders podem causar recompilação temporária. |
| Lixeira | Esvaziamento pelo Windows após confirmação digitada | Definitivo, sem desfazer. Fora dos perfis automáticos. |
| Análise de disco | Escolha de pasta; tamanhos por subpasta, maiores arquivos, gráfico e estatísticas de exclusão/quarentena | Somente leitura. Ignora links/junções e sinaliza análise parcial. Tamanho lógico não equivale a blocos físicos liberados. |
| Planos de energia | Troca de planos existentes; cópia Hero Notebook/Desktop; histórico restaura anterior e remove a cópia | CPU mínima 5%; máxima 100% na tomada; Notebook 85% na bateria. Sem overclock. Modern Standby/OEM/políticas podem impedir planos extras. |
| Medidores | CPU/RAM a cada 3 s; GPU, disco e rede a cada 5 s; histórico de 60 s | GPU mostra motor mais ocupado. Rede soma interfaces, que podem sobrepor tráfego virtual. Driver sem contador mostra N/D. Não mede FPS/temperatura. |
| Timer Resolution | `timeBeginPeriod(1)` durante foco e `timeEndPeriod(1)` ao terminar; consulta do timer | Desde Windows 10 2004, não garante mudar o timer de outros processos. Bloqueado em notebook. Sem injeção em jogos. |
| Mouse | WM_INPUT/GetRawInputData, contagem de relatórios e mediana dos intervalos | Estima frequência entregue pelo driver, não certifica taxa elétrica USB. Mova só um mouse. Não registra coordenadas/teclado. |
| Logitech | HID++ 2.0: bateria/firmware/DPI quando suportados; DPI limitado aos valores anunciados, com confirmação e histórico | Requer canal vendor, dispositivo acordado e slot correto. G Hub pode disputar acesso. Sem gravação de firmware. Não havia Logitech conectado para validar fisicamente esta entrega. |
| Drivers | Inventário, erros PnP, exportação de terceiros por PnPUtil e instalação de INF local | Exige administrador e backup atual antes de importar. Windows valida o pacote. Pode exigir reinicialização, nunca automática. Drivers internos não são exportados. |
| Serviços/tarefas | Lista restrita de serviços opcionais e tarefas de mapas/feedback; backup e restauração de estado | Manuais, fora dos perfis automáticos. Não altera Defender, firewall, Update ou anticheat. |
| Rede | AutoTuningLevelLocal, EcnCapability e Timestamps do TCP Internet, com backup | Administrador. Sem ganho universal de ping. Não altera DNS, adaptadores, Wi-Fi, MTU ou firewall. |
| Recuperação | Valores exatos, ausência e tipo do Registro; conflitos externos bloqueados; recuperação de prioridades/quarentena interrompidas | Falha de disco, exclusão/corrupção do histórico e mudanças externas podem exigir recuperação manual. |
| Ponto de restauração | Tentativa antes do primeiro ajuste com administrador; criação manual nas configurações | Depende da Proteção do Sistema e frequência permitida. Falhas são mostradas; backup por ajuste é independente. |
| Interface | Tema claro/escuro, movimento reduzido e tour de cinco passos | Preferências locais, sem conta. |
| Atualizações | GitHub `odesignerfelipe/heroboost`, consulta automática na versão instalada; checksum e instalação confirmada | Exige release pública com instalador e `latest.yml`. Portátil tem atualização manual. Sem certificado, a confiança depende do canal de publicação. |

Não há garantia de FPS, latência, fim de travamentos ou melhoria em qualquer PC. Algumas preferências exigem reabrir programas, sair/entrar na sessão ou reiniciar. O valor gravado não prova que uma versão futura do Windows/navegador ainda o consuma.

## Dados e recuperação

Dados em `%APPDATA%\Hero Boost\state.json`; quarentena em `%APPDATA%\Hero Boost\quarantine`. Preserve a pasta inteira enquanto precisar desfazer mudanças ou recuperar arquivos. O histórico contém caminhos locais e valores originais necessários à restauração; proteja-o como um arquivo pessoal.

O foco desliga ao fechar o Hero. O próximo início tenta restaurar prioridades e pausas temporárias pendentes, validando processo, caminho e início. Limpeza interrompida é reconciliada sem excluir arquivos. Arquivos novos não são sobrescritos. Se a pasta original foi removida, o arquivo permanece isolado.

Excluir quarentena, esvaziar Lixeira e remover dados de apps têm confirmações próprias. Isolar ainda ocupa espaço. A quarentena nunca é apagada em segundo plano.

## Desenvolvimento e testes

Node.js 24 LTS, npm e Windows x64:

```powershell
npm ci
npx install-electron --no
npm start
npm run check
npm test
npm run test:native
npm run smoke
npm run dist
```

`check` valida sintaxe JavaScript/PowerShell e UTF-8 com BOM para PowerShell 5.1. `test:native` usa apenas `HKCU\Software\HeroBoost-Tests-<GUID>`, removida ao final, para testar os helpers sem alterar preferências do Windows.

Os testes verificam persistência antes da mudança, restauração, conflitos, PID reutilizado, preferências protegidas, serviços/tarefas/rede simulados, mensagens HID++ simuladas, arquivos descartáveis reais, junções e falha de gravação. Um teste nativo altera/restaura prioridade de um processo descartável. Ações administrativas não foram executadas contra serviços, drivers ou configurações reais do usuário para validar esta entrega.

`smoke` usa `.qa/user-data` isolado, lê o Windows, visita as 15 telas, testa temas e abre/cancela a revisão de perfil. Produz `.qa/smoke.json`, `dashboard.png` e `light-theme.png`. Não aplica perfis, limpa arquivos, remove apps, troca planos ou instala drivers.

## Publicação de versões

`.github/workflows/release.yml` compila e testa no Windows ao enviar uma tag `v*`, produzindo uma **release em rascunho**, instalador NSIS, portátil, checksums e metadados. Revise e publique o rascunho para liberar o atualizador. O repositório precisa permitir escrita de conteúdo ao workflow. O campo `publish` do `package.json` aponta somente ao repositório informado.

Não coloque credenciais no código ou argumentos. O workflow usa `GITHUB_TOKEN` do Actions. Assinatura digital requer certificado/provedor e credenciais do responsável pela distribuição; nenhum certificado falso está embutido.

## Arquitetura e fontes

Interface local, Electron com sandbox/isolamento, Node desativado no renderer, CSP, remetente IPC validado, permissões negadas e navegação bloqueada. O preload só expõe ações enumeradas. O worker recebe dados JSON por stdin, nunca código da interface; só carrega módulos locais empacotados. Bypass vale apenas para o processo, sem mudar a política persistente do Windows.

Ações usam listas restritas; exclusão fica nas raízes previstas, sem seguir junções. HID usa N-API; mouse usa C# local carregado pelo PowerShell. Sem scripts de ajustes, drivers ou pacotes de otimização baixados. Apenas o atualizador consulta o canal de releases; diagnóstico não é enviado.

Fontes: [Electron](https://www.electronjs.org/docs/latest/tutorial/security), [Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input), [Timer Resolution](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod), [PnPUtil](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/pnputil-command-syntax), [Powercfg](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options), [privacidade](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-privacy), [Windows AI](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-windowsai), [Logitech](https://github.com/Logitech/cpg-docs/tree/master/hidpp20). Fontes por preferência constam de `native/settings.json`.
