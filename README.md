# Estoque do Bar — v2.5.2

## v2.5.2 — correção do lançamento de compras (mistura de unidades)

Na v2.5.1 o leitor de compras convertia `pacote → unidade-base × units_per_pack`
já no lançamento. Como a **contagem do estoque é mantida na unidade de contagem
do item** (`unit`), somar unidades-base numa contagem em pacotes misturava
unidades e corrompia o estoque assim que `base_unit ≠ unit` (ex.: contar 5
pacotes e comprar 3 pacotes resultava em 41 em vez de 8).

Correção: **a compra entra sempre na unidade de contagem do item, 1:1**. Regras
explícitas de `conversions` (ex.: `cx=36`) continuam valendo. O `units_per_pack`
deixa de ser aplicado no lançamento e fica **reservado ao consumo do PDV
(Fase 3)**, onde a conversão pacote→unidade realmente é usada. A fundação da
Fase 1 (coluna `base_unit`, `/state` expondo `baseUnit`/`unitsPerPack`, cadastro)
permanece intacta. Suíte: 103 testes, 103 passando.



Sistema real de inventário + PDV para operação do bar.

## v2.3.4 — confiabilidade do PDV e da fronteira de consumo

- **PDV sem venda duplicada em rede instável (P3):** a referência do pedido passa
  a ser estável por checkout (persistida em `localStorage`). Se a venda for gravada
  no backend mas a resposta se perder, uma nova tentativa reenvia a **mesma**
  referência e a idempotência do servidor devolve a venda existente — nunca duplica.
  A referência só é limpa após sucesso confirmado.
- **Consumo correto em PostgreSQL:** `entriesSince` normaliza o timestamp de
  fechamento (string do SQLite ou `Date` do PostgreSQL) em UTC antes de calcular a
  fronteira do snapshot, corrigindo o cálculo `base + entradas − final` em produção.
- **Service worker versionado:** `CACHE_NAME` atrelado à versão (`estoque-bar-pwa-2.3.4`),
  garantindo que cada release invalide os assets antigos.
- **Cobertura de RBAC do MANAGER** comprovada por testes (permitido em gestão,
  bloqueado em ações de ADMIN). `npm test`: 78 testes, 78 passando.

## Fase 2 — PDV real

Nesta fase o fluxo deixa de ser demonstração:

1. Operador entra no PDV.
2. Escolhe categoria e produto.
3. Configura tamanho/opções/adicionais/observação.
4. Monta o pedido localmente.
5. Informa a plaquinha por digitação livre (opcional).
6. Seleciona o local no mapa do bar.
7. Confere o total.
8. Confirma o pagamento.
9. O backend recalcula os preços a partir do catálogo.
10. A venda é gravada como `PAID`.
11. Movimentos de estoque aplicáveis são gravados na mesma transação.
12. O operador recebe a tela de venda processada e pode iniciar uma nova venda.

### Permissões do operador

`OPERATOR` possui uma interface exclusiva de atendimento. Pode montar e processar vendas e consultar o estoque em modo somente leitura. Não pode alterar contagens, chopp, preços, cadastro, relatórios ou configurações; essas restrições são aplicadas também no backend.

### Forma de pagamento

A forma de pagamento **não é registrada** nesta versão. O sistema registra o valor total processado; a conciliação financeira será feita posteriormente com o total consolidado da noite/fim de semana.

### Plaquinha e localização

Não existe comanda aberta. A plaquinha é somente uma referência operacional do pedido e pode ser digitada livremente. O local é selecionado visualmente no mapa.

### Estoque processado nesta fase

- Chopp: registra litros vendidos por tamanho.
- Refri / água / suco e doses vinculados ao estoque: baixam 1 unidade por produto vendido.
- Opções de drinks vinculadas ao estoque: registra 1 unidade por opção selecionada.
- Lanches e porções: não baixam estoque automaticamente nesta fase, conforme regra definida para o projeto.
- Adicionais: não possuem baixa automática nesta fase.

### Segurança da venda

O servidor é a autoridade para preço, produto, tamanho, grupos, opções e adicionais. O frontend não pode alterar o preço efetivamente gravado.

Cada venda possui uma referência única para impedir duplicação em caso de retry de rede.

## Desenvolvimento

```bash
npm install
npm test
npm run migrate
npm run seed
```

O frontend real é servido pelos arquivos de `frontend/` e o backend local por `backend/local-server.js`.

## Próxima etapa

Após validar o fluxo real de venda localmente, a próxima etapa é expandir gestão/relatórios de vendas e, depois, cozinha e regras adicionais de estoque.


### Cardápio rápido atual

Além de Chopps, Lanches, Porções e Drinks, o PDV possui as categorias `Refri / Água / Suco` e `Doses`. Os preços dessas categorias são definidos em `database/pdv-catalog.js` e entram no banco pelo seed idempotente `database/seed/02_pdv.js`.

O fechamento usa o mapa esquemático do bar, baseado no desenho operacional fornecido, com seleção visual por área e opção `Sem mesa`.


## v2.3.3 — Compras e Consumo robustos
- Leitor conservador: correspondência automática somente com confiança alta e margem segura.
- Conversões de embalagem/unidade configuráveis no cadastro.
- Entradas registram quantidade/unidade originais, conversão aplicada, resultado convertido, data operacional e timestamp real.
- O histórico preserva o fator usado mesmo se a conversão do cadastro mudar depois.
- Proteção contra relançamento do mesmo texto na mesma data.
- Consumo exibido pelo frontend vem exclusivamente de `/api/reports/consumption`.
- Inconsistências de estoque (disponível menor que a contagem final) são explicitadas, não convertidas em consumo negativo.
- Compras/Entradas e Consumo permanecem módulos separados.

## v2.3.3 — correções de validação local e navegação
- `npm run dev` agora sobe o servidor local completo (`backend/local-server.js`), servindo frontend e API na mesma origem.
- Fechamento de contagem passou a ser confirmado diretamente no servidor e recarrega o consumo após sucesso.
- Conversões também são salvas ao criar um novo item, não apenas ao editar.
- Categorias do estoque ficam todas visíveis e a categoria selecionada é preservada entre navegações.
- A tela de Compras foi explicitamente identificada como Leitor de Compras / Entrada de Estoque.
- O scanner por câmera/OCR de nota fiscal ainda não está implementado nesta versão.


## Fase 1 — Modelo híbrido de unidades (v2.5.1)

O estoque separa a unidade operacional/comercial (`unit`) da unidade-base de cálculo e consumo (`base_unit`). Itens existentes são migrados de forma conservadora com `base_unit = unit`; nenhum histórico é recalculado. O leitor pode converter `pacote` automaticamente usando `units_per_pack`. Caixa, fardo e demais embalagens continuam dependendo de regra explícita em `conversions`.
