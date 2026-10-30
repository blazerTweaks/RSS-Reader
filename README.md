# RSS

Leitor de RSS/Atom/JSON Feed em HTML, CSS e JavaScript puros — sem build e sem
backend. Funciona como site estático (GitHub Pages) e usa proxies CORS públicos
apenas como transporte, com cache local para não depender deles a cada abertura.

## Rodar localmente

Basta abrir `index.html` no navegador, ou servir a pasta:

```bash
python -m http.server 8080
# depois abra http://localhost:8080
```

## Publicar no GitHub Pages

1. Crie o repositório e envie os arquivos (`index.html`, `style.css`, `feed.js`, `reader.js`, `app.js`).
2. Em **Settings → Pages**, escolha a branch `main` e a pasta `/ (root)`.
3. O app fica em `https://SEU-USUARIO.github.io/REPOSITORIO/`.

Todos os caminhos são relativos, então funciona em subpastas sem ajustes.

## Como os feeds são buscados (CORS)

Navegadores bloqueiam a leitura de feeds de outros domínios, e não existe forma
de contornar isso apenas com JavaScript no cliente. Para manter o projeto 100%
estático, a busca passa por proxies CORS públicos (`allorigins`, `corsfix` e
`codetabs`) — não há nada para implantar ou configurar.

Feeds de commits do GitHub (`github.com/{owner}/{repo}/commits.atom`, com ou sem
branch) são a exceção: o app usa a API oficial `api.github.com`, que envia CORS,
sem passar por proxy nenhum. A API tem limite de 60 requisições por hora por IP
e não acessa repositórios privados.

Cada busca segue esta ordem:

1. **Cache fresco** (TTL de 20 minutos): nenhuma requisição é feita.
2. **Proxy que funcionou por último**, sozinho, para economizar a cota dos demais.
3. **Corrida** entre os demais proxies e o acesso direto (alguns feeds enviam CORS).
4. Se tudo falhar, o **último conteúdo em cache** é exibido, marcado como
   “em cache” no rodapé e no feed.

O cache fica em `localStorage` (`rss.cache`), com limite de ~200 KB por entrada e
30 entradas (as mais antigas saem primeiro). O proxy vencedor é lembrado em
`rss.proxyRank`.

A atualização automática roda a cada 30 minutos e só com a aba visível; o botão
**Atualizar** força a rede. Ao abrir o app, feeds com cache fresco carregam na hora.

### Limitações

- A primeira carga depende de um proxy público disponível; se todos caírem, só
  aparece o que já está em cache.
- Proxies públicos têm cotas e podem ficar instáveis ou mudar de regra sem aviso.
- As URLs dos feeds e dos artigos passam por terceiros.
- Feeds que exigem autenticação não funcionam.

## Recursos

- RSS 0.9x/2.0, RSS 1.0 (RDF), Atom 0.3/1.0 e JSON Feed; charset declarado é respeitado.
- Descoberta automática de feed a partir da URL do site; atalhos para YouTube
  (`/channel/…`, `@handle`, `/c/…`, `/user/…`, playlists), Reddit e feeds de
  commits do GitHub (via API oficial, com CORS).
- Cache local do corpo dos feeds e dos artigos, com fallback para conteúdo antigo
  quando os proxies falham.
- Posts iguais vindos de feeds diferentes são mesclados (link canônico), com selo `+N`.
- Leitor interno com sanitização de HTML, player de vídeo/áudio e extração do
  artigo completo quando o feed traz só resumo.
- Atalhos: `Esc` fecha, `j`/`k` navegam entre posts.
- Botão **Arquivar** no leitor e aba **Arquivados** na barra lateral. Posts
  arquivados saem de **Todos**, **Não lidos**, das visões de feed e dos contadores,
  mas continuam guardados como uma cópia leve no `localStorage` — inclusive depois
  de saírem do feed. O mesmo botão vira **Desarquivar** ao abrir um post arquivado.
- Painéis redimensionáveis: arraste a divisória à direita da barra lateral ou a
  divisória entre a lista e o leitor. Duplo clique/toque na divisória volta ao
  padrão, e as setas ←/→ ajustam com o teclado (Shift move mais). As larguras ficam
  salvas e o botão **Restaurar padrão** também as devolve a 280/420 px.
- Pastas e subpastas na barra lateral: crie, renomeie e exclua; mova feeds e
  pastas arrastando (SortableJS) ou pelo menu **Mover para pasta…** do feed. O
  cabeçalho da pasta expande/recolhe, e o contador mostra os não lidos somando as
  subpastas.
- Menu de contexto com botão direito (ou toque longo no celular) em feeds,
  pastas, posts e no leitor, com ações de abrir, mover, renomear, marcar como
  lido/não lido, copiar link e remover.
- Aba **Configurações** com importação/exportação de OPML (pastas preservadas),
  estatísticas do cache local e ajustes de aparência (tema, cor de destaque,
  densidade, fontes, miniaturas e animações), todos salvos automaticamente.
- Favicons locais: ícone do feed → `/favicon.ico` do site → ícone genérico. Nenhum
  serviço externo é consultado.
- Ícones do [Lucide](https://lucide.dev) (licença ISC), embutidos no próprio app:
  funcionam offline e não dependem de CDN.
- Estado em `localStorage`: a árvore de feeds/pastas fica em `tree`; também são
  usadas as chaves `rss.read`, `rss.archived`, `rss.sidebar`, `rss.cache`,
  `rss.proxyRank`, `rss.settings` e `rss.layout`. Quem vem do formato antigo
  (`rss.feeds`, `rss.folders`, `rss.foldersClosed`) é migrado automaticamente na
  primeira execução, e as chaves antigas ficam como backup.
- O arraste usa o SortableJS via CDN; sem internet o app continua funcionando, só
  o arrastar fica indisponível (os menus de contexto continuam ativos).

## Menu de contexto

Clique com o botão direito (ou segure o dedo por ~0,5 s no celular) sobre um
feed, uma pasta, um post ou o leitor para abrir o menu de ações:

- **Feed**: abrir, mover para pasta, marcar todos como lidos, renomear, copiar
  endereço e remover. A remoção é imediata e só existe por aqui — não há mais o
  botão “X” na barra lateral. Mover também só aparece neste menu (ou por arraste):
  os feeds não mostram mais botões ao passar o mouse.
- **Pasta**: nova subpasta, renomear, expandir/recolher, marcar tudo como lido e
  excluir (com a opção de mover os filhos para a raiz). Renomear e excluir só
  existem pelo menu — a barra lateral não mostra mais esses botões.
- **Post**: abrir no leitor ou no navegador, marcar como lido/não lido, ir para o
  feed, copiar link e copiar título.
- **Leitor**: abrir original, copiar link, copiar título e marcar como não lido
  (fechando o leitor).

Dentro do texto do artigo o menu nativo do navegador continua valendo, para não
atrapalhar seleção e cópia. O menu fecha com `Esc`, clique fora, rolagem ou
redimensionamento, e as setas do teclado navegam entre os itens. Nomear um feed
muda só o título exibido; a URL e as atualizações continuam iguais.

## Configurações de aparência

A aba **Configurações** começa pela seção **Aparência**. Cada mudança é aplicada
na hora e salva em `rss.settings`, sem botão de salvar:

- **Tema** escuro, claro ou automático (segue a preferência do sistema).
- **Cor de destaque** com seis presets e seletor livre. O app ajusta o tom dos
  links e escolhe o texto dos botões para manter contraste nos dois temas.
- **Densidade** confortável ou compacta.
- **Fonte da lista** pequena, padrão ou grande.
- **Miniaturas** nos cards (ligadas/desligadas).
- **Fonte do leitor** em 14, 16, 18 ou 20 px e **largura** entre painel inteiro e
  ~760 px.
- **Reduzir animações** desliga transições e animações da interface.
- **Restaurar padrão** devolve todos os campos ao valor original.

O tema e a cor também são aplicados por um script inline no `<head>`, antes da
primeira pintura, para evitar piscar com o esquema errado ao carregar.
