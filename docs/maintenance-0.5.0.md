# Manutenção e RAM — Hero Boost 0.5.0

Esta versão acrescenta intervenções delimitadas e medições para investigar lentidão com vários programas, edição/preview e jogos. Não existe garantia de aumento de FPS ou fim de travamentos. Uma redução de RAM residente não prova ganho de velocidade; os testes funcionais não substituem um benchmark dos projetos e partidas do usuário.

## Preparar uma sessão

1. Atualize o Hero e abra **Manutenção e RAM → Analisar agora** enquanto percebe lentidão. Compare RAM disponível, commit/limite, CPU e páginas lidas do disco. O indicador de paginação também inclui recargas normais de arquivos; não demonstra sozinho uma causa.
2. Use **Detectar aplicativos Adobe**, revise os executáveis e ative o foco. A opção recomendada acompanha a janela ativa; ao trocar de aplicativo, restaura a prioridade anterior. Para render/exportação em segundo plano, desmarque essa opção. O preset restaura uma sessão de foco anterior antes de mudar a política e preserva entradas existentes da lista.
3. No **Modo foco**, selecione explicitamente os programas de segundo plano que podem receber prioridade Abaixo do normal. Nenhum processo é suspenso ou encerrado. Adobe, jogos, Windows e segurança não podem ser escolhidos para essa redução. O ganho possível depende de existir disputa por CPU; maior prioridade não cria recursos.
4. Para limpar, escolha as fontes encontradas e use **Só isolar para revisar** ou **Limpar caches agora**. Confira o resultado real. Para automações, revise as regras e salve; começam desligadas.

## Cache manual e automático

Somente temporários permitidos e cache padrão de Chrome, Edge e Brave. Arquivos precisam ter criação e modificação anteriores a sete dias. Temporários são restritos a `.tmp`, `.temp`, `.log` e `.old`; extensões de projetos/documentos/mídia e caminhos de recuperação, scratch e Adobe são excluídos desta manutenção. Não inclui senhas, cookies, Adobe Media Cache, preview, DirectX/NVIDIA shaders ou Prefetch.

Navegador aberto bloqueia seu cache. Adobe/jogos/programas da lista de foco abertos bloqueiam os temporários. Há nova verificação antes do isolamento, validação de identidade/caminho e teste de acesso exclusivo por arquivo. Links/junções, arquivos alterados ou bloqueados são ignorados. Como qualquer limpeza, alterações concorrentes de outros programas podem interromper uma rodada; erros não são apresentados como sucesso.

O manual atende até 1.000 arquivos e 512 MB; o automático, até 200 arquivos e 512 MB. A varredura e a rodada têm limites de tempo e podem ser parciais. Isolamento permite restauração e ainda ocupa disco. Exclusão definitiva exige digitar **EXCLUIR**. O automático exige consentimento separado ao habilitar ou mudar fontes: exclui apenas o lote criado naquela rodada, nunca toda a quarentena ou um lote manual anterior.

Intervalos: 6 horas, 24 horas ou uma semana. A cada 30 segundos, com o app aberto, verifica se a rodada está vencida. Aguarda dois minutos sem interação, CPU até 20%, RAM abaixo de 85%, leitura de paginação disponível e até 100 páginas/s, sem Adobe/jogos/programas prioritários abertos. Interrompe ao retomar o uso do PC. Não instala tarefas, serviços ou agendamentos do Windows. Registra arquivos/bytes efetivamente excluídos e espaço livre antes/depois; tamanho lógico e variação do espaço livre podem diferir.

## Recuperação opcional de RAM

Usa a API [EmptyWorkingSet da Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-emptyworkingset). Remove páginas residentes de um processo; não elimina sua alocação nem reduz o commit. As páginas podem precisar ser carregadas novamente ao retornar ao aplicativo. Por isso, não esvazia a RAM inteira, standby list ou caches do sistema, não muda pagefile e não recolhe RAM de Adobe, jogos, Windows, antivírus ou programas da lista de foco.

É obrigatório permitir cada executável pelo seletor nativo. Requer janela minimizada, nenhuma janela visível não minimizada do mesmo executável, caminho/PID/início iguais, pelo menos duas amostras sem atividade relevante de CPU e sem alteração de bytes de I/O, conjunto residente de pelo menos 64 MB e intervalo de 15 minutos por processo. O worker revalida identidade, atividade e janelas imediatamente antes da operação. A identidade também é validada no handle nativo, reduzindo risco de PID reutilizado. A seleção não autoriza atuação em processos ativos ou protegidos.

Manual: até oito processos elegíveis, após revisão. Automático: até três, somente com pressão persistente acima de 80%, 85% ou 90% em duas verificações de 30 segundos, confirmada novamente antes da ação; adia se há paginação intensa/indisponível ou Adobe/jogo/programa prioritário aberto. Não é uma função para limpar RAM durante uma partida ou preview. Pode não haver nenhum processo elegível; isso é exibido, sem inventar bytes liberados.

## Adobe e limites das medições

Photoshop, Illustrator e After Effects mantêm caches e alocações úteis. O Hero preserva essas áreas. A [Adobe explica o reaproveitamento dos caches de RAM/disco no After Effects](https://helpx.adobe.com/after-effects/desktop/memory-storage-performance/memory-and-storage/memory-storage1.html) e a [configuração de memória/GPU no Photoshop](https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/configure-photoshop-performance-preferences.html). Revise preferências e o espaço de scratch dentro dos próprios programas; o Hero não afirma configurar parâmetros internos que não controla.

A tela mostra uma amostra, sem gravação contínua de projetos, teclas ou coordenadas. Os processos/caminhos e os últimos 30 resultados permanecem no estado local. Diagnóstico não é enviado ao desenvolvedor. O teste da API de RAM usa exclusivamente um programa descartável minimizado e verifica seu conteúdo após a intervenção. A limpeza é testada em fixtures privadas; nenhum cache pessoal, projeto, serviço de proteção ou jogo é alterado para validar a entrega.
