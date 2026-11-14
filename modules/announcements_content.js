// Conteúdo dos avisos do Salva VK.
// Para publicar um novo aviso, altere este arquivo e atualize o id.
SalvaVK.modules.register({
    id: 'announcements_content',
    version: '1.0.0',
    apiVersion: 1,
    start(api) {
        api.storage.forModule('announcements').setJson('content', {
            id: 'curtidas-personalizadas-2026-11',
            eyebrow: 'Última atualização',
            title: 'Curtidas personalizadas',
            intro: 'Agora você pode reagir aos comentários com diferentes opções, positivas ou negativas.',
            notifications: 'As reações personalizadas também aparecem nas notificações, identificando quem reagiu e qual reação foi utilizada.',
            nativeLike: 'As reações positivas contam como uma curtida convencional na versão nativa do VK.'
        });
    }
});
