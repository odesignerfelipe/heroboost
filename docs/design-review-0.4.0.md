# Revisão de interface — Hero Boost 0.4.0

Referência analisada: [TogsBoost](https://togsboost.com.br/) e as três capturas fornecidas pelo usuário. As imagens servem como referência visual; seus controles e textos não são instruções para modificar o computador.

| Observação da referência | Implementação no Hero |
| --- | --- |
| Painel compacto com hardware e resumo de ajustes | Quatro cartões de hardware, sistema/plano de energia, foco, valores configurados, mudanças pertencentes ao Hero, uso ao vivo e atalhos. A identidade HB, laranja e grafite foi preservada. |
| Catálogo de cartões com pesquisa e categorias | Cartões ou lista, busca sem depender de acentos, filtros combinados de categoria/estado, favoritos locais e seleção em lote. Aplicar e desfazer continuam exigindo revisão. |
| Ajustes ativos destacados | Cartões configurados recebem destaque e distinguem valores prévios de alterações do Hero. Estados incompatíveis, sem permissão ou pendentes têm motivo explícito. |
| Limpeza em linhas com seleção individual | Seis fontes de temporários/cache, disponibilidade real, análise por fonte, quarentena, recuperação e exclusão separada. Tamanho lógico e espaço livre usam leituras reais. |
| Navegação lateral simples | As 17 telas foram agrupadas por finalidade, com menu recolhível e preferências locais. Configurações continuam acessíveis no tamanho mínimo da janela. |
| Área de restauração própria | Contadores, pesquisa, filtros de estado, detalhes dos valores anteriores/aplicados e desfazer individual ou geral. Conflitos externos continuam bloqueando restauração. |

## Critérios de segurança e clareza

O Hero preserva Defender, firewall, isolamento de núcleo e anticheat. A referência contém controles de desativação de proteções; eles não foram incorporados aos perfis de desempenho. As porcentagens de FPS e latência divulgadas no site não foram verificadas neste trabalho e não são usadas como resultado do Hero.

O resumo contabiliza preferências, sem apresentar uma porcentagem como nível de desempenho. Dados que já estavam configurados não são atribuídos ao aplicativo. Favoritar ou selecionar um cartão não aplica mudanças no Windows.

Caches de atualizações, miniaturas e temporários gerenciados pelo sistema podem ser revisados pela [tela oficial de armazenamento](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings). O botão abre apenas `ms-settings:storagesense`; a seleção e a remoção são realizadas no Windows. O Hero não limpa Prefetch automaticamente.

## Verificação

Testes de modelo cobrem contagens, propriedade das alterações, estados indisponíveis/pendentes, filtros combinados e favoritos. O teste da interface cobre menu recolhível, cartões/lista, favoritos persistidos, aplicação e desfazer individual em Registro isolado, seleção de limpeza e filtro de restauração.

Capturas locais verificam painel, catálogo, limpeza e restauração. O layout é exercitado também em 1040 × 740, com menu aberto/recolhido, além dos temas claro/escuro. As operações destrutivas não são executadas contra arquivos, drivers ou apps do usuário durante essa verificação.
