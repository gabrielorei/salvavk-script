// Conteúdo dos avisos do Salva VK.
// Para publicar um novo aviso, altere este arquivo e atualize o id.
//
// Campos:
//   eyebrow / title / intro : cabeçalho (intro aceita **negrito**)
//   preview  : { reactions: [3 ou 4 emojis]  → barra de reações na prévia
//                active:    índice da reação destacada (simula o hover)
//                ambient:   [10 emojis]      → textura sutil no espaço livre }
//   items    : [{ icon, color, title, text }]   → um ícone aceso à esquerda
//              ou { emojis: [até 3], title, text } → emojis em círculos
//              ícones disponíveis: heart, bell, smile, pin, bookmark
//   hint     : (opcional) { icon, text } → dica no rodapé do painel esquerdo
//   button   : (opcional) texto do botão
SalvaVK.modules.register({
    id: 'announcements_content',
    version: '2.6.0',
    apiVersion: 1,
    start(api) {
        api.storage.forModule('announcements').setJson('content', {
            id: 'curtidas-personalizadas-2026-11-v8',
            eyebrow: 'Última atualização',
            title: 'Curtidas personalizadas',
            intro: 'Agora você pode **reagir aos comentários** com diferentes emojis, além da curtida habitual do VK.',
            preview: {
                reactions: ['❤️', '🔥', '😂', '👏'],
                active: 1, // reação destacada na prévia (0 = primeira)
                ambient: ['❤️', '🔥', '😂', '👏', '😲', '😈', '🙄', '🤡', '😭', '🤬']
            },
            items: [
                {
                    emojis: ['😂', '🙄', '🔥'],
                    title: 'Reações personalizadas',
                    text: 'Escolha a reação que melhor combina com o comentário.'
                },
                {
                    icon: 'bell',
                    color: '#3d8bfd',
                    title: 'Nas notificações',
                    text: 'Elas aparecem na aba de notificações, mostrando quem reagiu e qual foi a reação ao seu post.'
                },
                {
                    icon: 'heart',
                    color: '#e5245f',
                    title: 'Curtida nativa',
                    text: 'As reações positivas também contam como curtida na versão nativa do VK.' // \u00A0 = espaço que não quebra: mantém "na versão" junto na linha de baixo
                }
            ],
            hint: {
                icon: 'heart',
                text: 'Para reagir, **passe o mouse no ícone** de curtida do VK.'
            }
        });
    }
});
