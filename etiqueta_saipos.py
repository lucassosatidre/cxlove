"""
ETIQUETA SAIPOS -> ELGIN L42PRO FULL
Pizzaria Estrela da Ilha
v14.5 - Ordem fixa na coluna direita: outros -> brotos (penultimo) -> bebidas (ultimo)
"""

VERSION = "210"
# v205 (23/09/26): QR saia CORTADO na direita (foto do Lucas, pedido #0008): ficava a 2 px da borda e a
#   Elgin nao imprime os ultimos milimetros do papel. Agora fica QR_BORDA_DIR_PX (3 mm) pra dentro, e o
#   rodape/meio encolhem junto. Log da nuvem confirmou: impressao ok, so o desenho encostava na borda.
# v204 (23/09/26): UMA ETIQUETA POR PRODUTO + QR (Lucas). Pedido do Provisao: cada pizza (salgada ou doce)
#   e cada Pote Dip vira UMA etiqueta so com ELE no meio ("#0004 - 2/3" = "1x Pizza Broto: Nutella com
#   Morango"); cabecalho e rodape iguais (ITENS conta o pedido inteiro). Bebida e observacao do pedido
#   aparecem em TODAS as etiquetas. Quando o Provisao manda o codigo do produto (itens[].qr, "EQ"+10),
#   a etiqueta ganha um QR pequeno no canto inferior direito: a pistola 2D no Mana da "Pronta e
#   conferida" daquela pizza. QR gerado aqui mesmo (sem biblioteca nova nos PCs), conferido modulo a
#   modulo contra a biblioteca "qrcode". Sem codigo = etiqueta sem QR (igual antes). Salao/Saipos nao muda.
# v203 (23/09/26): LOG DAS IMPRESSOES NA NUVEM (Lucas: "guardar os logs num lugar que voce acessa facil").
#   Antes o log vivia so em Downloads\etiqueta_saipos_log.txt de cada PC (ninguem via de fora). Agora cada
#   etiqueta do Provisao gera um evento (etiqueta_ok/erro, cupom, marcada, devolvida...) com PC, versao,
#   pedido e impressora, enviado pela mesma fila (mesma chave) pra tabela etiqueta_impressao_log do Provisao.
#   E um "estou vivo" a cada 5 min (tabela etiqueta_pcs) mostra quais PCs estao ligados e prontos.
#   Sem internet os eventos esperam na memoria (ate 500) e vao no proximo ciclo. O log local continua.
# v202 (23/09/26): FROTA INTEIRA vira servidor de etiqueta (Lucas: "nem sempre todos estao ligados, algum
#   pode estragar"). Antes so o PC do caixa buscava a fila do Provisao; se ele desligasse, as etiquetas de
#   iFood/Brendi/Atendente ficavam paradas. Agora TODO PC com a chave (Downloads\sofia_caixa.json) e que
#   enxerga a impressora das caixas (.14) busca a fila. Nao duplica: a nuvem entrega cada etiqueta a UM PC
#   so (reserva atomica). (1) imprimir_etiqueta passa a devolver True/False — antes engolia o erro e a
#   etiqueta era marcada "impressa" mesmo sem sair; (2) so o que saiu e marcado; o que falhou volta pra fila
#   na hora e o PC sai da fila por 1 min (outro assume); cupom so sai junto com as etiquetas (nao repete);
#   (3) cada reserva grava o nome do PC (claimed_by) — auditoria sabe quem imprimiu; (4) PC sem chave ou sem
#   impressora avisa no log (1x a cada 30 min) em vez de ficar mudo.
# v201 (22/09/26): etiqueta do Provisao — (1) HORA saia crua e em UTC ("2026-09-20T21:09:21.376Z") no
#   cabecalho da etiqueta e do cupom; agora sai "18:09" (horario de Brasilia). O cupom tambem mostrava a
#   data do DIA DA IMPRESSAO; agora mostra a data do pedido. (2) OBSERVACAO ("Obs: todas sem cebola") saia
#   como "1x Obs: ..." e CONTAVA em ITENS (pedido #25: 6 itens, etiqueta dizia 8 — o motoboy confere por
#   esse numero). Agora vira linha propria, sem "1x", fora da contagem, e obs repetida sai uma vez so.
# v200 (19/09/26): salão usa catálogo fechado e nome canônico. Texto fora do
#   catálogo vira aviso, nunca sabor/caixa. Remove abreviações "com" -> "c/".
# v198 (18/09/26): payload do Provisao segue o mesmo padrao do Saipos: Pote Dip e item separado,
#   conta em ITENS e ganha etiqueta propria; refrigerante conta em ITENS sem gerar etiqueta.
# v197 (18/09/26): etiquetas do Provisao agora imprimem a forma real de pagamento, bandeira e valor
#   (ex.: VALE ALELO R$123,39), inclusive quando ha mais de uma parcela. Antes a fila reduzia tudo a
#   COBRAR e o rodape mostrava somente a quantidade de itens.
# v196 (18/09/26): FILTRO de tipo/canal (Lucas). So SALAO (tratado acima) + retirada criada DIRETO
#   no Saipos (canal vazio) imprimem etiqueta e vao pro Mana. ENTREGA e retirada de canal online
#   (iFood/Brendi/menu proprio) vao pelo Provisao -> BLOQUEIA (sem etiqueta, sem Mana).
# v195 (17/09/26): fila de etiquetas do Provisão migrou para o Supabase próprio. O helper passa a
#   usar o destino novo por padrão e também corrige em memória os dois endereços antigos que podem
#   ter ficado gravados em sofia_caixa.json. O segredo local é preservado e nunca vai para o Git.
#   A fila agora identifica o canal real (iFood/Brendi/Salao/Luci) na etiqueta, no cupom e no log,
#   em vez de chamar todo pedido de SOFIA. SALAO também ganha cabeçalho próprio.
# v194 (25/07/26): BORDA DIP (potinho). A borda recheada virou "Pote Dip X" (Catupiry/Cheddar/Chocolate):
#   pote plastico A PARTE, nao vai na pizza. Antes ele entrava como FATIA ("1/2 1 Pote Dip Cheddar"),
#   inflava a ocupacao de slots (split criava pizza fantasma, ex. #0042: "1/2 Frango" sozinho numa 2a
#   caixa) e o dip de chocolate caia no eh_sabor_doce virando caixa_doce falsa que ROUBAVA os sabores da
#   pizza (#0151). Agora: novo tipo "dip" (eh_pote_dip/nome_pote_dip) nos 3 caminhos (papel/salao/KDS);
#   na comanda vai como ref (rodape, junto de broto doce/bebida); na etiqueta sai na coluna direita
#   colado nas bebidas; e cada potinho SOMA 1 etiqueta (num_etiquetas = caixas + dips) pra colar no pote.
#   total_caixas segue so pizzas (o servidor usa como nº de pizzas). Checar dip SEMPRE antes de eh_borda
#   ("Borda Dip" comeca com "borda") e de eh_sabor_doce (chocolate).
# v193 (01/07/26): COMANDA/KDS — combo "1 pizza + bebida" (ex.: "Pizza Gigante + Refri 1,5l", SEM "N X
#   Pizza" no nome -> mult==1) pedido Nx: a pizza saía qty=N (certo) mas a BEBIDA/refs saíam 1x só (Coca de
#   combo pedido 2x vinha qty=1) e total_caixas contava 1 item em vez de N. Causa: o ramo `else` de
#   extrair_itens_kds punha qty na caixa mas classificava as escolhas 1x só. Pedido real #11 (30/06): 2
#   Gigantes iguais + Refri -> KDS mostrava 1 Coca e total_caixas=2. Agora o `else` REPLICA a pizza+escolhas
#   qty vezes (qty=1 cada), igual ao ramo mult>1 -> N pizzas + N bebidas + total_caixas certo. So o caminho
#   do KDS/comanda (etiqueta fisica usa extrair_itens_printrows, intacta). Harness: #11 (2 Gig+Coca 2x) +
#   pizza simples 1x/2x + combo doce + obs sem regressao.
# v192 (27/06/26): SALAO combo "N X Pizza" (multiplicador X separado, ex.: "2 X Pizza Grande") nao dividia
#   e deixava o "X" grudado no nome. O regex de topo comia o N; agora re-cola o N no "x" orfao pra
#   contar_pizzas_no_nome dividir certo (espelha o delivery). Guardado: so dispara no "x " orfao -> item
#   normal ("2 Pizza"/"Pizza ...") intacto. Validado na cadeia de helpers (auditoria 27/06).
# v191 (20/06/26): ETIQUETA do DELIVERY — COMBO carro-chefe pedido Nx (Qt>1) saía 1x só. O papel do iFood
#   lista o combo UMA vez ("2  2x Pizza Grande + Refrigerante" = 2 pizzas/combo, pedido 2x) e a Qt do item
#   (o "2 " da frente) era IGNORADA no ramo mult>1 do extrair_itens_printrows -> só 1 combo era emitido.
#   Pedido real #128 (20/06): 4 pizzas + 2 Cocas viravam 2 pizzas + 1 Coca na etiqueta (o KDS já saía certo,
#   pois extrair_itens_kds emite o combo qty vezes desde v188). Mesma falha no #2 (hoje). Agora a etiqueta
#   replica os itens do combo (pizzas + bebida + borda) qty vezes ANTES do split por slots. Combo COM
#   marcador "Nª Pizza" (Brendi) NÃO replica (combo_marker) -> pizzas já enumeradas. Harness: #128/#2 (4+2),
#   combo 1x sem regressão, simples 2x, marcador 1x/2x, combo+borda. Diff old/new em ~12 pedidos REAIS de
#   todos os caminhos (salão/Brendi/iFood/gigante×2/broto): idênticos exceto o #128 (2->4 caixas), confirmado.
# v190 (20/06/26): AUTO-UPDATE da FROTA. A checagem de versao nova (check_update a cada 30min) estava
#   DEPOIS do "if not cfg: continue" no sofia_poll_loop -> so o PC do caixa (com sofia_caixa.json)
#   atualizava sozinho; os PCs de COZINHA so pegavam versao nova ao REINICIAR. Resultado: o combo do
#   pedido #0033 (20/06 17:29) saiu duplicado (3 pizzas em vez de 2) porque o PC ainda rodava v187,
#   mesmo com a correcao v189 ja publicada as 17:10. Agora o check_update roda em TODO PC, sempre.
# v189 (20/06/26): ETIQUETA do DELIVERY (extrair_itens_printrows) — 3 bugs de combo iFood (pedidos reais
#   147/227/229/36). (1) QUEBRA DE LINHA do Saipos ("...Refrigerante Te"+"mx", "...Recheada T"+"EMX",
#   "Catupir"+"y") corrompia nome ("GrandeEMX") e criava caixa fantasma -> pre-passo junta fragmento (1-6
#   letras) na linha anterior. (2) COMBO "2x Pizza Grande" com marcador SO na 1a pizza (227) nao dividia ->
#   split agora dispara por TRANSBORDO de fatias (ceil(ocupado/slots)), nao so por qty>1. (3) _alvo() criava
#   a 1a pizza do combo com qty=combo_mult -> com marcador "2a Pizza" o split DUPLICAVA a 1a (229) -> qty=1.
#   (4) BROTO cujo sabor e doce ("Sensacao") virava caixa vazia + doce separada (36) -> promove a doce (v185
#   do KDS portado). (5) ADICIONAL com fracao ("-1/2 Adicional de Milho") era lido como fatia e o split o
#   isolava numa pizza fantasma (147) -> vira "+ X" (regra v176). Varredura 196 pedidos reais: 0 regressao.
# v188 (20/06/26): COMANDA/KDS — combo pedido Nx (quantity>1) saia 1x so. O extrair_itens_kds usava o
#   multiplicador do NOME do combo ("2 X Pizza" = 2 pizzas/combo) mas IGNORAVA o quantity do item (quantas
#   vezes o combo foi pedido). Pedido real iFood "2x Pizza Grande + Coca" pedido 2x virava 2 pizzas + 1 Coca
#   em vez de 4 pizzas + 2 Cocas. Agora emite o combo `qty` vezes. So o caminho do KDS/comanda (a etiqueta
#   ja dividia caixa qty>1 desde v187). Harness: combo_grp_qty2 (4 pizzas + 2 bebidas) + qty1 sem regressao.
# v187 (13/06/26): ETIQUETA do DELIVERY — combo "2x Pizza Grande" do iFood (e qualquer combo SEM os
#   marcadores "Na Pizza") saia com as fatias TODAS numa caixa qty=2 -> consolidar somava "3/2 Calabresa"
#   nas DUAS etiquetas (pedido 168 real). Agora, no fim do extrair_itens_printrows, toda caixa com qty>1 e
#   dividida em qty pizzas enchendo por SLOTS do tamanho (2 p/ Grande): ex [1/2,1/2,1/2 Cal + 1/2 Port] ->
#   Pizza 1 "2/2 Calabresa" + Pizza 2 "1/2 Calabresa,1/2 Portuguesa". Combo COM marcador (Brendi, v186) ja
#   sai como caixas qty 1 -> nao re-divide. Harness: 168 iFood + 205/196 Brendi + unica + 2x mesmo sabor.
# v186 (13/06/26): ETIQUETA do DELIVERY — combo "2x Pizza Grande" virava 1 pizza com 4 sabores em vez de
#   2 pizzas com 2 sabores cada (pedido 205 real). O marcador no papel da Brendi vem como "-1 1a Pizza com
#   Borda de X" (qty colada, SEM 'x') -> caia no ramo ms2 do extrair_itens_printrows, que NAO tirava o "1 "
#   da frente -> _salao_marker_pizza nao reconhecia o marcador -> combo nao dividia. Agora tira a qty antes
#   do marcador (igual o ms/mp ja faziam). KDS/comanda ja lia certo (caminho separado). Harness: 205 + 196
#   (combo+broto) + pizza unica + unica+broto, todos batendo.
# v185 (08/06/26): (1) ADICIONAL sem ordinal num COMBO 2x agora vai em TODAS as pizzas (montadores
#   diferentes fazem cada uma; antes so na 1a). (2) BROTO cujo SABOR e doce ("Pizza Broto" + "Chocolate
#   Mesclado", SEM "Doce" no nome) era classificado SALGADO -> saia VAZIO, o sabor doce flutuava como caixa
#   solta e a borda ficava orfa (embaralhava 2 brotos). Agora detecta doce pelo SABOR (todos os sabores
#   doces -> broto doce), no caminho unico e no combo. Harness broto_matrix (2D) + obs_geral_borda_doce.
# v184 (08/06/26): 2 correcoes. (1) OBS GERAL do pedido num COMBO 2x agora vai em CADA pizza/comanda
#   (montadores diferentes fazem a 1a e a 2a) — _kds_combo recebe item_nota e emite "Obs:" por pizza;
#   pizza unica (mult==1) segue emitindo 1x. (2) BORDA do BROTO DOCE ia parar na pizza SALGADA (o split
#   joga borda solta na ultima salgada) -> agora a borda de um broto doce fica NO proprio broto (campo
#   _bordas -> "Borda: X" nos sabores dele, igual obs/adic do broto). Harness obs_geral_borda_doce.
# v183 (08/06/26): OBS COLADA NO ITEM (decisao do dono, mapeado com pedido de teste com obs em todo campo).
#   Cada observacao (lapis do Saipos) agora viaja COLADA no item a que pertence, nos 2 caminhos (pizza unica
#   + combo): SABOR -> "1/3 X (obs: ...)" (_fl ganhou 4o campo = nota); BORDA/BEBIDA/BROTO -> campo "_obs"
#   (vira "Obs:" nos sabores do proprio item); ADICIONAL -> "+ X (nota)". ANTES: a obs da BORDA e do REFRI
#   eram DESCARTADAS e a do BROTO caia na pizza salgada. So a obs GERAL da pizza segue como balao "Obs:" na
#   pizza. _kds_classifica/_kds_attach/_kds_fl_sab/_kds_combo + caminho unico. Harness obs_colada (7 campos).
# v182 (08/06/26): a OBSERVACAO do BROTO DOCE (ex "massa bem assada" no Broto de Charge) ia parar na
#   pizza SALGADA. O parser emitia a obs como item "Obs:" solto, mas o split (splitPcItems/groupPizzas)
#   gruda TODO "Obs:" na ultima salgada. Agora a obs FICA no proprio broto (campo _obs -> vira "Obs:"
#   nos sabores dele, renderizado por _kds_fl_sab), no combo e na pizza unica doce. Harness broto_obs.
# v181 (08/06/26): 3 correcoes do COMBO achadas na auditoria (rodando o parser real em 6 dimensoes):
#   (1) [ALTA] combo de broto DOCE ("2x Pizza Broto Doce") DOBRAVA as caixas (N vazias + N com o sabor
#       virando nome) -> agora o sabor doce do PROPRIO combo doce fica na caixa (so desvia p/ extras se a
#       base NAO e doce). (2) [ALTA] borda SEM ordinal (combo do DELIVERY) grudava toda na ULTIMA pizza ->
#       agora casa pela CHAVE do grupo (id_store_choice), 1 borda por pizza. (3) [MEDIA] combo perdia a
#       observacao do proprio broto doce. Harness: 5 casos + regressao borda/sem-borda/adic-nota/amendoim.
# v180 (08/06/26): COMBO do KDS/terminal: a OBSERVACAO do adicional (ex "Adicional de Milho" com nota
#   "na de bacon") era descartada -> agora vai junto "+ Adicional de Milho (na de bacon)", igual o salao
#   do papel. Vale p/ adicional salgado (na pizza) e doce (no broto). _kds_combo agora carrega a nota
#   por adics e extras. Harness: pedido real 763860638.
# v179 (08/06/26): COMBO do KDS/terminal: ADICIONAL DOCE (ex "Adicional de Leite Condensado") caia
#   solto como item "outro" em vez de grudar no broto doce. No _kds_combo o adicional doce ia pra
#   lista 'extras' e era processado com cur=None -> nunca achava o broto. Agora gruda no broto doce
#   (vira "+ X" no card), tolerando adicional antes/depois do broto em chs. Adicional salgado (na
#   pizza, por ordinal) e o caminho avulso (_kds_classifica com cur) ja funcionavam. Harness: 4 casos.
# v178 (08/06/26): COMBO do SALAO no KDS/terminal: "Sem Borda Recheada" virava um item de BORDA
#   ("BORDA: Recheada" na comanda) -> INVERSAO de sentido: cliente pediu SEM borda e o pizzaiolo
#   era mandado fazer borda recheada. _kds_combo era o UNICO dos 8 pontos de "sem borda" que jogava
#   na lista de bordas em vez de pular. Agora pula (igual papel L793 e _kds_classifica L912). Borda
#   de verdade (chocolate/catupiry) intacta. Reproduzido com a mesa 56 real + 3 casos no harness.
# v177 (05/06/26): COMBO do DELIVERY ("2 X Pizza Grande + Refrigerante", o carro-chefe) agora DIVIDE
#   em N pizzas separadas (igual o salao), pelos marcadores "1a/2a Pizza" — antes saia 1 caixa
#   "Pizza Grande x2" com as 4 metades empilhadas. Cada sabor vai pra pizza certa (cur_caixa). Total
#   de caixas/etiquetas inalterado (2 grandes + broto = 3). Bordas seguem como itens com o numero
#   "Na Pizza" (colove anexa). Verificado: E1-E8 + S1-S8 + varredura de regressao.
# v176 (05/06/26): SALAO reescrito (estava bem atras do delivery) + adicional/obs GRUDADOS no item:
#   (1) ADICIONAL no salao virava FATIA ("1/4 Adicional de Cebola"). Agora eh_adicional -> nao conta
#       fatia; vira "+ Adicional de X" colado na pizza. (2) OBSERVACAO (** **) no salao era IGNORADA
#       -> agora vira balao "Obs:" (igual delivery). (3) Obs logo DEPOIS de um adicional vira a NOTA
#       dele ("+ Adicional de Cebola (calabresa)") -- nos dois tradutores. (4) COMBO "2 X Pizza" do
#       salao nao dividia (saia "1/6"); agora divide em N pizzas pelos marcadores "Na Pizza" + le a
#       fracao do texto. (5) "Sem Borda Recheada" e broto doce tratados certo. Verificado: 14 pedidos
#       reais (S1-6 salao + E1-8 delivery/retirada) reproduzidos + py_compile.
# v175 (01/06/26): consertos achados na auditoria em massa (344 pedidos reais reproduzidos):
#   (1) CASHBACK/obs: bloco ** ... ** com `**` sozinho numa linha (ou valor depois) NAO fechava ->
#       engolia os sabores -> PIZZA VAZIA (#150). Reescrito: fecha no 1o `**` depois da abertura;
#       linha que comeca com "-" (sabor) fecha a obs antes; flush no "Quantidade de itens"; tira
#       ruido de CASHBACK da observacao.
#   (2) ADICIONAL: "-1x Adicional de X" virava fatia (fracao impossivel "5/3", #219). Agora
#       eh_adicional() -> item a parte, nao conta como fatia (espelha o salao).
#   (3) NOME CORTADO: quebra de linha colava com espaco e minusculo ("SEM QU"+"EIJO"->"SEM QU eijo").
#       Agora cola sem espaco no corte de palavra, preserva o caso e re-abrevia -> "SEM QUEIJO".
#   (4) "Sem Borda Recheada" nao e sabor -> pulado (nao infla fracao do combo nem polui).
#   Verificado: py_compile + reproducao dos pedidos reais (#150/#219/SEM QUEIJO) + 4 controles.
# v174 (01/06/26): (1) ACENTO na fonte: corrigir_encoding agora devolve com acento (Muçarela,
#   Camarão, Brócolis, Sensação, Prestígio, Guaraná, Açaí, Maracujá...) em vez de ASCII — antes
#   dependia do dicionario da IA re-acentuar, mas o fetch do dicionario falha em PC antigo e a
#   comanda saia "Mucarela". Mesmo casamento testado; so a saida mudou. (2) slots_do_tamanho sem
#   "familia" (a Estrela so tem broto/grande/gigante). Verificado: py_compile + 4 reais + render.
# v173 (01/06/26): 3 bugs de LEITURA (validados em pedidos reais do banco + 2 controles):
#   (a) TEMX: sabores vinham em sub-linha "-1x Lombo" (sem fracao) e viravam item "outro" -> a
#       pizza ficava SEM sabor nenhum. Agora "-Nx Sabor" depois de uma pizza salgada vira sabor
#       dela (denominador = slots do tamanho: broto1/grande2/gigante3/familia4) via _anexar_sabor.
#   (b) BROTO DOCE sem prefixo: "-1x Sensacao Mesclado" (broto doce escrito sem "Pizza Broto de")
#       virava "outro"/sabor errado. Novo eh_sabor_doce -> vira caixa_doce (forneiro), nao sabor.
#   (c) "Borda Broto de X"/"Borda Cheddar" nao era reconhecida como borda (eh_borda so pegava
#       "borda de") -> virava pizza salgada inteira. Agora eh_borda pega nome que comeca com "borda".
#   NAO mexe no nome cru da borda ("1 Pizza com Borda...") de proposito: o colove usa o numero pra
#   anexar a borda na pizza certa do combo. Verificado: py_compile + 4 pedidos reais + render.
# v172 (01/06/26): RAIZ da multiplicacao de regras da IA. abreviar_sabor MINUSCULAVA a 1a letra
#   do sabor ("Calabresa" -> "calabresa"), o que obrigava o dicionario da IA a criar uma regra de
#   capitalizacao por COMBINACAO de sabor (~50 regras-remendo). Agora capitaliza ("Calabresa
#   c/ Catupiry" sai certo direto). Resultado final IDENTICO ao que ja saia (o dicionario corrige
#   o mesmo depois), mas para de depender das ~50 regras. NAO toca "SEM QUEIJO" (so a 1a letra).
#   Acento (encoding) e additive caps ("c/ CATUPIRY") seguem no dicionario (poucas, estaveis).
# v171 (01/06/26): observacao do cliente (bloco ** ... **) vira item "Obs:" (balao de obs na
#   comanda) em vez de colar no nome da pizza ("Pizza Grandesem borda por favor" era o bug).
# v170 (01/06/26): broto SALGADO ("Pizza Broto" sem doce no nome) vira caixa_salgada (era doce ->
#   comanda em branco, bug #38); consolidar_sabores junta metades iguais ("2/2 calabresa" em vez de
#   "1/2 calabresa" duplicado, bug #66). So muda o leitor de itens; render da etiqueta intacto.
# v169 (30/05/26): CONSERTO leitor do salao. Sub-linha "-1 Borda ..." (sem x) era descartada e
#   bebida de combo ("-1x Caneca Individual de Coca Cola") virava SABOR da pizza. Agora cada
#   sub-linha e classificada: borda -> item borda; bebida (lista do cardapio) -> item bebida;
#   senao -> sabor. Aceita "-N" sem x. _salao_eh_bebida expandida c/ cardapio real (sem acento).
# v168 (30/05/26): CONSERTO salao nao imprimia. As filas do CO LOVE (comanda_outbox/debug_outbox/etc)
#   ficavam DENTRO de Downloads/saipos, que e a ENTRADA do Saipos Printer -> poluia a pasta dele e ele
#   engasgava (entrega tinha a etiqueta nossa de fallback, salao nao tinha nada -> salao sem papel).
#   Agora as filas vivem em ~/colove_fila (fora da pasta do Saipos Printer) + limpa as subpastas antigas no boot.
# v167 (29/05/26): regras do dicionario sao LITERAIS (str.replace), nunca regex. Mata risco de
#   ReDoS travar a impressao (re.sub sem timeout) e de backreference falhar em silencio. is_regex ignorado.
# v166 (29/05/26): + aplica o "dicionario" de regras da IA na escrita dos itens (encoding/
#   sabor_alias/borda_cleanup/abbrev). So vem regra se debug_apply_rules=true no servidor;
#   senao a edge devolve vazio e o comportamento e IDENTICO ao de hoje. abbrev so na etiqueta.
# v165 (29/05/26): + envia a "foto" crua de cada pedido pro CO LOVE (texto do Saipos + itens
#   parseados) pra IA diaria melhorar escrita/exibicao. Best-effort, NUNCA afeta impressao,
#   gated no servidor por debug_capture_enabled. Mesmo opt-out local da comanda.
# v160 (29/05/26): + Comanda Virtual embutida (empurra pedido pro CO LOVE, sem senha, interruptor central).
# v159 (29/05/26): legibilidade da etiqueta CO LOVE. Texto branco em fundo PRETO saia
#   apagado/ilegivel na termica (traco branco fino "enche" no campo preto). Invertido pra
#   FUNDO BRANCO + TEXTO PRETO (traco preto fino imprime nitido). Margem direita maior +
#   texto centralizado na area util pra nao cortar a lateral direita. Mesmo layout (5 linhas).
# v157 (29/05/26): etiqueta CO LOVE deixava de caber em 1 etiqueta (espalhava em 2).
#   Agora o tamanho do papel e' FORCADO pra 50x25mm via DEVMODE/ResetDC e a imagem e'
#   desenhada na area real de impressao (HORZRES/VERTRES) da impressora de producao.
#   Se o driver ignorar o tamanho, avisa no log pra calibrar a impressora. Fallback seguro.
UPDATE_URL = "https://raw.githubusercontent.com/lucassosatidre/cxlove/main/etiqueta_saipos.py"

import os, sys, json, re, time, subprocess, tempfile, base64, shutil, urllib.parse, urllib.request, urllib.error, threading, ssl
from datetime import datetime, timezone, timedelta
try:
    from zoneinfo import ZoneInfo
    _BR_TZ = ZoneInfo("America/Sao_Paulo")
except Exception:
    _BR_TZ = timezone(timedelta(hours=-3))

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "watchdog"])
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont

PASTA_DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")
PASTA_SAIPOS = os.path.join(PASTA_DOWNLOADS, "saipos")  # ENTRADA do Saipos Printer: aqui SO vao arquivos de impressao
# NOSSOS arquivos de dados (filas pro CO LOVE) ficam FORA da pasta do Saipos Printer, pra nao poluir a entrada dele:
PASTA_FILA = os.path.join(os.path.expanduser("~"), "colove_fila")
NOME_IMPRESSORA = "ELGIN L42PRO FULL"
LARGURA_MM = 80; ALTURA_MM = 30; DPI = 203
LARGURA_PX = int(LARGURA_MM * DPI / 25.4)
ALTURA_PX = int(ALTURA_MM * DPI / 25.4)
LOG_FILE = os.path.join(PASTA_DOWNLOADS, "etiqueta_saipos_log.txt")
DEBUG_FILE = os.path.join(PASTA_DOWNLOADS, "etiqueta_debug.txt")
processados_arquivos = {}; processados_id_sale = {}; cache_pagamento = {}
_print_lock = threading.Lock()   # serializa impressao entre o watcher Saipos e o poller Sofia

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S"); linha = f"[{ts}] {msg}"; print(linha)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f: f.write(linha + "\n")
    except: pass

def debug_save(filename, print_rows):
    try:
        with open(DEBUG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*60}\nARQUIVO: {filename}\nHORA: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n{'='*60}\n")
            for i, row in enumerate(print_rows):
                limpo = re.sub(r'<[^>]+>', '', row).strip()
                if limpo: f.write(f"  [{i:3d}] {limpo}\n")
            f.write(f"{'='*60}\n\n")
    except: pass

def check_update():
    try:
        import ssl
        # Contexto SSL permissivo (resolve erros de certificado em Windows antigo)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(UPDATE_URL, headers={"Cache-Control": "no-cache"})
        resp = urllib.request.urlopen(req, timeout=5, context=ctx)
        conteudo = resp.read().decode("utf-8")
        m = re.search(r'^VERSION\s*=\s*["\'](\d+)["\']', conteudo, re.MULTILINE)
        if m:
            remote = int(m.group(1)); local = int(VERSION)
            if remote > local:
                log(f"  UPDATE: v{local} -> v{remote}")
                with open(os.path.abspath(__file__), "w", encoding="utf-8") as f: f.write(conteudo)
                log(f"  Reiniciando..."); os.execv(sys.executable, [sys.executable] + sys.argv)
            else: log(f"  Versao v{VERSION} (ok)")
    except Exception as e: log(f"  Update: {e}")

def limpar_tags(texto):
    return re.sub(r'<[^>]+>', '', texto).strip()

def corrigir_encoding(texto):
    # v174: SAIDA com acento (antes era ASCII e o dicionario da IA re-acentuava — mas o fetch do
    # dicionario falha em PC antigo, entao a comanda saia sem acento). Mesmo "casamento" testado de
    # antes (case-sensitive); so a saida ganhou acento. Acento estavel agora nao depende do dicionario.
    texto = re.sub(r'[Mm]u.?arela', 'Muçarela', texto)
    texto = re.sub(r'[Cc]ala.?resa', 'Calabresa', texto)
    texto = re.sub(r'[Ss]ensa.{0,2}o\b', 'Sensação', texto)
    texto = re.sub(r'[Cc]ama.{0,2}o\b', 'Camarão', texto)
    texto = re.sub(r'[Cc]amar.o\b', 'Camarão', texto)
    texto = re.sub(r'[Bb]r.coli', 'Brócoli', texto)
    texto = re.sub(r'[Cc]atup.ry', 'Catupiry', texto)
    texto = re.sub(r'[Pp]rest.gio', 'Prestígio', texto)
    texto = re.sub(r'[Rr]equeij.o', 'Requeijão', texto)
    texto = re.sub(r'[Ff]eij.o', 'Feijão', texto)
    texto = re.sub(r'[Gg]uaran.[\s]*[Zz]ero', 'Guaraná Zero', texto)
    texto = re.sub(r'[Gg]uaran.\s', 'Guaraná ', texto)
    texto = re.sub(r'[Aa].?a[ií]\b', 'Açaí', texto)
    texto = re.sub(r'[Mm]aracuj.', 'Maracujá', texto)
    texto = re.sub(r'(\w)[^\w\s]o\b', r'\1ão', texto)
    texto = texto.replace("\ufffd", "").replace("\u25a1", "")
    texto = re.sub(r'\s{2,}', ' ', texto)
    return texto

def limpar_nome(nome):
    nome = re.sub(r"##", "", nome)
    nome = re.sub(r"''+.*?''+", "", nome); nome = re.sub(r"'+", "", nome)
    nome = re.sub(r'""+.*?""+', "", nome); nome = re.sub(r'"+', "", nome)
    nome = re.sub(r'\(Obs[.:].*?\)', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'CASHBACK.*', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'desconto\s+do\s+restaurante.*', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'[)\]}>]+$', '', nome); nome = re.sub(r'\*+', '', nome)
    nome = re.sub(r'\s+', ' ', nome).strip(); nome = nome.strip("'\" .*#,;:")
    nome = corrigir_encoding(nome)
    return nome

def abreviar_sabor(sabor):
    s = corrigir_encoding(sabor.strip())
    s = re.sub(r'^[Tt]emx\s+[Pp]izza\s+de\s+', '', s)
    s = s.strip()
    # v172: capitaliza a 1a letra (antes minusculava, obrigando o dicionario a ter 1 regra de
    # capitalizacao por sabor). So a 1a letra: nao mexe em "SEM QUEIJO"/"c/ CATUPIRY" (dicionario).
    if s: s = s[0].upper() + s[1:]
    return s

ORDINAL = r'\d+.?'
def eh_borda(nome):
    n = nome.lower()
    if "borda de" in n: return True
    if n.strip().startswith("borda"): return True   # "Borda Broto de Cheddar", "Borda Cheddar"
    if re.match(ORDINAL + r'\s+(pizza\s+)?(temx\s+)?(com\s+)?borda', n, re.IGNORECASE): return True
    if "temx borda" in n: return True
    return False
def eh_sabor_temx(nome):
    n = nome.lower().strip()
    if re.match(r'^temx\s+pizza\s+de\s+', n, re.IGNORECASE):
        resto = re.sub(r'^temx\s+pizza\s+de\s+', '', n, flags=re.IGNORECASE)
        if any(t in resto for t in ["broto", "grande", "gigante"]): return False
        return True
    return False
def eh_sabor_numerado(nome):
    n = nome.strip()
    if re.match(ORDINAL + r'\s+[Pp]izza\s+\d+/\d+', n): return True
    if re.match(ORDINAL + r'\s+[Pp]izza\s+de\s+', n):
        if "borda" not in n.lower(): return True
    return False
def eh_fracao(texto):
    return bool(re.match(r'^-?\s*\d+/\d+\s+', texto.strip()))
def extrair_sabor_fracao(texto):
    m = re.match(r'^-?\s*(\d+)/(\d+)\s+(.+?)(?:\s{2,}[\d,.]+)?$', texto.strip())
    if m:
        num = int(m.group(1)); den = int(m.group(2))
        sabor = abreviar_sabor(m.group(3).strip())
        return num, den, sabor
    return None, None, ""
# Sabores DOCES que aparecem no NOME do produto broto (ex.: "Pizza Broto de Nutella").
# Broto SALGADO vem como produto "Pizza Broto" (sem doce no nome) + sabor na sub-linha.
_BROTO_DOCES = ("nutella", "chocolate", "sensacao", "sensação", "charge", "prestigio",
    "prestígio", "brigadeiro", "doce", "morango", "leite cond", "ovomaltine", "oreo",
    "banana", "romeu", "confete", "ferrero", "ninho", "kit kat", "kitkat", "beijinho",
    "cartola", "bicho de pe", "bicho de pé", "sonho de valsa", "coco", "cocada")
def eh_broto_doce(nome):
    n = (nome or "").lower()
    if "broto" not in n and "brotinho" not in n: return False
    return any(d in n for d in _BROTO_DOCES)
def eh_pizza_salgada(nome):
    """Pizza salgada: gigante, grande, OU broto SALGADO (Pizza Broto sem doce no nome)."""
    n = nome.lower().strip()
    if eh_borda(nome): return False
    if eh_sabor_temx(nome): return False
    if eh_sabor_numerado(nome): return False
    # broto SALGADO tambem e pizza salgada (sabor vem na sub-linha); broto DOCE nao (vai pra direita)
    if "broto" in n or "brotinho" in n: return not eh_broto_doce(nome)
    palavras = ["pizza gigante", "pizza grande", "gigante", "grande",
                "temx pizza gigante", "temx pizza grande"]
    for p in palavras:
        if p in n: return True
    return False
def eh_pizza_broto(nome):
    """Pizza broto DOCE (caixa_doce / coluna direita). Broto SALGADO e tratado como salgada."""
    n = nome.lower().strip()
    if eh_borda(nome): return False
    if eh_sabor_temx(nome): return False
    if eh_sabor_numerado(nome): return False
    if "broto" in n or "brotinho" in n: return eh_broto_doce(nome)
    return False
def slots_do_tamanho(nome):
    """Quantos sabores cabem no tamanho (regra do dono): broto 1, grande 2, gigante 3.
    A Estrela so tem esses 3 tamanhos (sem Familia)."""
    n = (nome or "").lower()
    if "gigante" in n: return 3
    if "broto" in n or "brotinho" in n: return 1
    if "grande" in n: return 2
    return 2
def eh_sabor_doce(nome):
    """Sabor de broto DOCE mesmo SEM o prefixo 'Pizza Broto de' (ex.: '-1x Sensacao Mesclado')."""
    n = corrigir_encoding(nome or "").lower()
    return any(d in n for d in _BROTO_DOCES)
def eh_adicional(nome):
    """'Adicional de X' = topping, NAO e sabor/fatia (senao infla a fracao, ex 5/3). Igual o salao."""
    return bool(re.search(r'\badicional\b', nome or "", re.IGNORECASE))
def eh_pote_dip(nome):
    """BORDA DIP (potinho): recheio que ANTES ia na borda recheada e agora vai num pote plastico A PARTE
    (Catupiry/Cheddar/Chocolate). NAO e sabor nem borda da pizza: vira item proprio (tipo 'dip'), sai
    junto de bebida/broto doce (comanda e etiqueta) e SOMA 1 etiqueta (a que cola no potinho).
    Checar SEMPRE antes de eh_borda ('Borda Dip' comeca com 'borda') e de eh_sabor_doce (dip de chocolate)."""
    n = _sem_acento(corrigir_encoding(nome or "").lower())
    n = re.sub(r'^[-\s]*(?:\d+/\d+\s+)?(?:\d+\s*x?\s+)*', '', n)   # tira fracao/qty da frente ("1/2 1 Pote Dip...")
    return bool(re.match(r'^(?:pote|borda)\s+dip\b', n) or re.match(r'^dip\b', n))
def nome_pote_dip(nome):
    """Nome limpo do potinho ('1/2 1 Pote Dip Cheddar' -> 'Pote Dip Cheddar')."""
    s = corrigir_encoding((nome or "").strip())
    s = re.sub(r'^[-\s]*(?:\d+/\d+\s+)?(?:\d+\s*[xX]?\s+)*', '', s).strip(" -")
    return (s[0].upper() + s[1:]) if s else "Pote Dip"
def _anexar_sabor(display, sabor, qty):
    """Anexa o sabor (sub-linha '-Nx Sabor' estilo Temx) na pizza SALGADA mais recente.
    Denominador = slots do tamanho (gigante 3 etc.); consolidar_sabores junta iguais. True se anexou."""
    for d in reversed(display):
        if d["tipo"] == "caixa_salgada":
            d["sabores_raw"].append((qty, slots_do_tamanho(d["nome"]), abreviar_sabor(sabor)))
            return True
    return False
def eh_caixa_pizza(nome):
    """Qualquer pizza que vira caixa (conta como etiqueta)"""
    return eh_pizza_salgada(nome) or eh_pizza_broto(nome)
def eh_bebida(nome):
    # Delega pro detector compartilhado (lista completa dos cardapios). Definido mais abaixo;
    # resolvido em tempo de chamada. Cobre refri/cerveja/vinho/caipirinha/drink/caneca de combo etc.
    return _salao_eh_bebida(nome)
def contar_pizzas_no_nome(nome):
    m = re.match(r'^(\d+)\s*x\s+', nome, re.IGNORECASE)
    return int(m.group(1)) if m else 1
def nome_sem_combo(nome):
    nome = re.sub(r'^\d+\s*x\s+', '', nome, flags=re.IGNORECASE)
    nome = re.sub(r'\s*\+\s*(refrigerante|coca.*|pureza.*|refri.*)$', '', nome, flags=re.IGNORECASE)
    return nome.strip()
def nome_borda_curto(nome):
    m = re.search(r'[Bb]orda\s+de\s+(.+)', nome)
    return corrigir_encoding(m.group(1).strip()) if m else corrigir_encoding(nome)
def eh_elemento_cozinha(elemento):
    ps = elemento.get("printSettings", {})
    if ps.get("type") == 1: return True
    rows = elemento.get("printRows", [])
    for row in rows:
        if re.search(r'#\d+\s*-\s*\d+/\d+', limpar_tags(row)): return True
    return False
def ler_arquivo_saipos(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f: conteudo = f.read().strip()
        if conteudo.startswith("{") or conteudo.startswith("["): return json.loads(conteudo)
        try:
            padded = conteudo + "=" * (4 - len(conteudo) % 4)
            decoded = base64.b64decode(padded).decode("utf-8", errors="replace")
            if decoded.startswith("{") or decoded.startswith("["): return json.loads(decoded)
        except: pass
        try:
            url_decoded = urllib.parse.unquote(conteudo)
            padded = url_decoded + "=" * (4 - len(url_decoded) % 4)
            decoded = base64.b64decode(padded).decode("utf-8", errors="replace")
            if decoded.startswith("{") or decoded.startswith("["): return json.loads(decoded)
        except: pass
        return None
    except: return None

def consolidar_sabores(sabores_raw):
    if not sabores_raw: return []
    grupos = {}; ordem = []
    for num, den, nome in sabores_raw:
        key = (den, nome)
        if key not in grupos: grupos[key] = 0; ordem.append(key)
        grupos[key] += num
    resultado = []
    for den, nome in ordem:
        total_num = grupos[(den, nome)]
        # junta metades iguais: 2 metades de calabresa -> "2/2 calabresa" (inteira), sem repetir "1/2"
        resultado.append(f"{total_num}/{den} {nome}")
    return resultado

def _flush_obs(display, obs_acc, pend_adic=None):
    """Fecha o bloco de observacao do cliente. Tira ruido de CASHBACK/desconto (promo do canal).
    Se veio logo apos um adicional (pend_adic), vira a NOTA dele ('+ Adicional de Cebola (calabresa)');
    senao vira um item balao 'Obs:'."""
    txt = " ".join(obs_acc).strip()
    txt = re.sub(r'cashback.*', '', txt, flags=re.IGNORECASE).strip()
    txt = txt.strip(" .,-*")
    if not txt: return
    if pend_adic is not None:
        pend_adic[1] = txt; return
    display.append({"tipo": "outro", "nome": f"Obs: {txt}", "qty": 1, "sabores_raw": []})

def extrair_itens_printrows(print_rows):
    # v189 PRE-PASSO: o Saipos QUEBRA linhas longas (ex.: "...Refrigerante Te"+"mx",
    # "...Recheada T"+"EMX", "Catupir"+"y"). O fragmento solto na linha seguinte virava nome
    # corrompido ("GrandeEMX") ou caixa fantasma (pedido 229). Junta o fragmento (1-6 letras puras,
    # sem '-'/dígito/espaço) no FIM da linha anterior, só no miolo de itens.
    _rows = []; _inz = False
    for _r in print_rows:
        _t = limpar_tags(_r).strip()
        if "Qt.Descri" in _t: _inz = True; _rows.append(_r); continue
        if "Quantidade de itens" in _t: _inz = False; _rows.append(_r); continue
        if _inz and _rows and re.match(r'^[A-Za-zÀ-ÿ]{1,6}$', _t) and limpar_tags(_rows[-1]).strip():
            _rows[-1] = limpar_tags(_rows[-1]).rstrip() + _t   # continuação -> cola no fim da anterior
            continue
        _rows.append(_r)
    print_rows = _rows
    display = []; total_caixas = 0; total_bebidas = 0; total_outros = 0
    em_zona = False; ultimo_tipo = None; em_obs = False; obs_acc = []
    pend_adic = None   # adicional aguardando a obs da linha seguinte -> vira a nota "(calabresa)"
    cur_caixa = None; combo_nome = None; combo_doce = False; combo_pizzas = {}; combo_mult = 1   # combo "2 X Pizza" dividido
    combo_open = None; combo_marker = False; combo_segs = []   # v191: combo pedido Nx (qty>1) SEM marcador -> replica o combo qty vezes
    def _alvo():
        nonlocal cur_caixa, total_caixas
        if cur_caixa is not None: return cur_caixa
        if combo_nome:                                 # combo ATIVO sem pizza atual -> cria a caixa do combo PRIMEIRO
            # v189: qty=1 (não combo_mult). Se NÃO houver marcador "Nª Pizza", todas as fatias caem aqui e o
            # split-por-transbordo no fim divide em ceil(ocupado/slots) pizzas. Se HOUVER marcador, a 2ª pizza
            # vira outra caixa — e a 1ª NÃO pode ficar com qty=combo_mult (senão o split a duplicava, pedido 229).
            c = {"tipo": "caixa_doce" if combo_doce else "caixa_salgada", "nome": combo_nome, "qty": 1, "sabores_raw": []}
            combo_pizzas[1] = c; display.append(c); total_caixas += 1; cur_caixa = c; return c
        for d in reversed(display):                    # so DEPOIS cai na ultima caixa (item anterior) -> nunca rouba caixa do item passado
            if d["tipo"] in ("caixa_salgada", "caixa_doce"): return d
        return None
    def _add_adic(nome, qty):
        nonlocal pend_adic, total_outros
        ad = [abreviar_sabor(nome), ""]; alvo = _alvo()
        if alvo is not None:
            alvo.setdefault("_adic", []).append(ad); pend_adic = ad; return
        display.append({"tipo": "outro", "nome": nome, "qty": qty, "sabores_raw": []}); total_outros += qty
    def _attach_sabor(nome, qty):
        alvo = _alvo()
        if alvo is None: return False
        alvo["sabores_raw"].append((qty, slots_do_tamanho(alvo["nome"]), abreviar_sabor(nome))); return True
    for row in print_rows:
        texto = limpar_tags(row)
        if "Qt.Descri" in texto: em_zona = True; continue
        if "Quantidade de itens" in texto:
            if em_obs: _flush_obs(display, obs_acc, pend_adic); obs_acc = []; em_obs = False  # nunca engolir itens
            em_zona = False; continue
        if not em_zona: continue
        if not texto or texto == " ": continue
        texto_limpo = texto.strip()

        # Observacao do cliente: bloco entre ** ... ** (pode quebrar em varias linhas e vir com
        # CASHBACK misturado). Vira item "Obs:" e NUNCA pode engolir os sabores (bug pizza vazia, #150).
        # SEGURANCA: se, estando em_obs, aparece uma linha que comeca com "-" (= sabor/borda/bebida),
        # o bloco ja acabou (texto de obs nao comeca com "-") -> fecha a obs e REPROCESSA esta linha.
        if em_obs and texto_limpo.startswith("-"):
            _flush_obs(display, obs_acc, pend_adic); obs_acc = []; em_obs = False; pend_adic = None
            # cai pro fluxo normal abaixo (sem continue)
        elif em_obs or texto_limpo.startswith("**"):
            # so tira o ** da FRENTE quando e a ABERTURA; dentro do bloco, um ** (ate sozinho) FECHA.
            resto = texto_limpo[2:] if (texto_limpo.startswith("**") and not em_obs) else texto_limpo
            if "**" in resto:                       # fecha no PRIMEIRO ** depois da abertura
                antes = resto.split("**", 1)[0].strip()
                if antes: obs_acc.append(antes)
                _flush_obs(display, obs_acc, pend_adic); obs_acc = []; em_obs = False; pend_adic = None
            else:
                p = resto.strip()
                if p: obs_acc.append(p)
                em_obs = True
            ultimo_tipo = "obs"
            continue
        pend_adic = None   # qualquer item que nao seja obs encerra a janela de nota do adicional

        mp = re.match(r'^(\d+)\s{2,}(.+?)(?:\s{2,}[\d,.]+)?$', texto_limpo)
        if mp:
            qty = int(mp.group(1)); nome_raw = limpar_nome(mp.group(2).strip())
            ultimo_tipo = "item"
            if combo_open is not None:                         # v191: item de TOPO encerra o combo anterior (sub-itens vêm em "-...")
                if combo_open[1] > 1 and not combo_marker: combo_segs.append((combo_open[0], len(display), combo_open[1]))
                combo_open = None
            if eh_pote_dip(nome_raw):                          # potinho da borda dip = item proprio (antes de eh_borda: "Borda Dip" comeca com "borda")
                display.append({"tipo": "dip", "nome": nome_pote_dip(nome_raw), "qty": qty, "sabores_raw": []})
            elif eh_borda(nome_raw):
                display.append({"tipo": "borda", "nome": nome_raw, "qty": qty, "sabores_raw": []})
            elif eh_pizza_salgada(nome_raw):
                mult = contar_pizzas_no_nome(nome_raw); base = nome_sem_combo(nome_raw)
                if mult > 1:                                   # combo "2 X Pizza" -> divide pelos marcadores "Na Pizza"
                    combo_nome = base or "Pizza"; combo_doce = False; combo_pizzas = {}; combo_mult = mult; cur_caixa = None
                    combo_open = (len(display), qty); combo_marker = False   # v191: combo pedido `qty` vezes (iFood "2  2x Pizza...")
                else:
                    c = {"tipo": "caixa_salgada", "nome": base, "qty": qty, "sabores_raw": []}
                    display.append(c); total_caixas += qty; cur_caixa = c; combo_nome = None
            elif eh_pizza_broto(nome_raw):
                mult = contar_pizzas_no_nome(nome_raw); base = nome_sem_combo(nome_raw)
                if mult > 1:
                    combo_nome = base or "Pizza"; combo_doce = True; combo_pizzas = {}; combo_mult = mult; cur_caixa = None
                    combo_open = (len(display), qty); combo_marker = False   # v191
                else:
                    c = {"tipo": "caixa_doce", "nome": base, "qty": qty, "sabores_raw": []}
                    display.append(c); total_caixas += qty; cur_caixa = c; combo_nome = None
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_bebidas += qty
            elif nome_raw:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_outros += qty
            continue
        ms = re.match(r'^-\s*(\d+)x\s+(.+?)(?:\s{2,}[\d,.]+)?$', texto_limpo)
        if ms:
            qty = int(ms.group(1)); nome_raw = limpar_nome(ms.group(2).strip())
            ultimo_tipo = "item"
            if combo_nome:                                     # marcador "Na Pizza ..." -> cria/troca a pizza do combo
                _ordn, _resto = _salao_marker_pizza(nome_raw)
                if _ordn is not None:
                    combo_marker = True                        # v191: combo COM marcador (Brendi) -> NÃO replica (pizzas já enumeradas)
                    if _ordn not in combo_pizzas:
                        c = {"tipo": "caixa_doce" if combo_doce else "caixa_salgada", "nome": combo_nome, "qty": 1, "sabores_raw": []}
                        combo_pizzas[_ordn] = c; display.append(c); total_caixas += 1
                    cur_caixa = combo_pizzas[_ordn]
                    _mf = re.match(r'^(\d+)/(\d+)\s+(.+)$', _resto)
                    if _mf:                                    # "Na Pizza 1/2 Calabresa" -> sabor da pizza N
                        cur_caixa["sabores_raw"].append((int(_mf.group(1)), int(_mf.group(2)), abreviar_sabor(_mf.group(3)))); continue
                    if "sem borda" in _resto.lower(): continue
                    # senao (borda): segue a classificacao normal mantendo o nome com o numero (colove usa)
            if eh_pote_dip(nome_raw):                          # potinho da borda dip = item proprio (nunca sabor/borda/caixa doce)
                display.append({"tipo": "dip", "nome": nome_pote_dip(nome_raw), "qty": qty, "sabores_raw": []})
            elif eh_borda(nome_raw):
                display.append({"tipo": "borda", "nome": nome_raw, "qty": qty, "sabores_raw": []})
            elif "sem borda" in nome_raw.lower(): continue   # "Sem Borda Recheada" nao e sabor
            elif eh_sabor_temx(nome_raw): continue
            elif eh_sabor_numerado(nome_raw): continue
            elif eh_pizza_salgada(nome_raw):
                c = {"tipo": "caixa_salgada", "nome": nome_raw, "qty": qty, "sabores_raw": []}; display.append(c); total_caixas += qty; cur_caixa = c
            elif eh_pizza_broto(nome_raw):
                c = {"tipo": "caixa_doce", "nome": nome_raw, "qty": qty, "sabores_raw": []}; display.append(c); total_caixas += qty; cur_caixa = c
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_bebidas += qty
            elif eh_sabor_doce(nome_raw):                      # broto doce sem prefixo "Pizza Broto de"
                if cur_caixa is not None and "broto" in (cur_caixa.get("nome") or "").lower() and not cur_caixa.get("sabores_raw"):
                    cur_caixa["tipo"] = "caixa_doce"           # v189: broto cujo SABOR é doce (ex "Sensação") -> o sabor é DELE, promove a doce (não cria caixa nova; portado do KDS v185)
                    cur_caixa["sabores_raw"].append((1, slots_do_tamanho(cur_caixa.get("nome") or "") or 1, abreviar_sabor(re.sub(r'^\d+\s+', '', nome_raw))))
                else:
                    c = {"tipo": "caixa_doce", "nome": nome_raw, "qty": qty, "sabores_raw": []}; display.append(c); total_caixas += qty; cur_caixa = c
            elif eh_adicional(nome_raw):                       # "Adicional de X" -> GRUDA na pizza ("+ X"), NAO fatia
                _add_adic(nome_raw, qty)
            elif _attach_sabor(nome_raw, qty):                 # "-Nx Sabor" (Temx) -> sabor da pizza atual
                pass
            elif nome_raw:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": qty, "sabores_raw": []}); total_outros += qty
            continue
        if eh_fracao(texto_limpo):
            num, den, sabor = extrair_sabor_fracao(texto_limpo)
            if sabor and num and den and "sem borda" not in sabor.lower():  # "Sem Borda Recheada" nao e sabor
                if eh_pote_dip(sabor):                 # "-1/2 1 Pote Dip Cheddar" NAO e fatia: e o potinho a parte.
                    # Sem tirar daqui, ele inflava a ocupacao de slots e o split criava pizza fantasma
                    # (ex.: Grande 1/2 dip + 1/2 Calabresa + 1/2 Frango virava 2 caixas). qty = num da fracao.
                    display.append({"tipo": "dip", "nome": nome_pote_dip(sabor), "qty": max(1, num), "sabores_raw": []})
                    ultimo_tipo = "item"; continue
                if eh_adicional(sabor):                # v189: "-1/2 Adicional de Milho" e ADICIONAL (+ X), NAO fatia
                    _add_adic(sabor, 1)                #   (regra v176). Sem isso ele inflava as fatias e o split
                    ultimo_tipo = "item"; continue     #   por transbordo criava uma pizza fantasma "2/2 Adicional" (pedido 147).
                alvo = _alvo()
                if alvo is not None: alvo["sabores_raw"].append((num, den, sabor))   # vai pra pizza atual (cur_caixa no combo)
            ultimo_tipo = "sabor"; continue
        ms2 = re.match(r'^-\s*(.+?)(?:\s{2,}[\d,.]+)?$', texto_limpo)
        if ms2:
            nome_raw = limpar_nome(ms2.group(1).strip())
            ultimo_tipo = "item"
            if combo_nome:                                     # marcador "Na Pizza ..." (sub-linha sem 'x')
                # No DELIVERY o marcador vem com a qty colada ("-1 1a Pizza com Borda..."); o ms2 NAO
                # tira o "1 " da frente (so o ms/mp tiram) -> o marcador nao era reconhecido e o combo
                # de 2 pizzas virava 1 pizza com 4 sabores (bug pedido 205, 13/06). Tira a qty antes.
                _ordn, _resto = _salao_marker_pizza(re.sub(r'^\d+\s+', '', nome_raw))
                if _ordn is not None:
                    combo_marker = True                        # v191: combo COM marcador (Brendi) -> NÃO replica
                    if _ordn not in combo_pizzas:
                        c = {"tipo": "caixa_doce" if combo_doce else "caixa_salgada", "nome": combo_nome, "qty": 1, "sabores_raw": []}
                        combo_pizzas[_ordn] = c; display.append(c); total_caixas += 1
                    cur_caixa = combo_pizzas[_ordn]
                    _mf = re.match(r'^(\d+)/(\d+)\s+(.+)$', _resto)
                    if _mf:
                        cur_caixa["sabores_raw"].append((int(_mf.group(1)), int(_mf.group(2)), abreviar_sabor(_mf.group(3)))); continue
                    if "sem borda" in _resto.lower(): continue
            if eh_pote_dip(nome_raw):                          # potinho da borda dip = item proprio
                display.append({"tipo": "dip", "nome": nome_pote_dip(nome_raw), "qty": 1, "sabores_raw": []})
            elif eh_borda(nome_raw):
                display.append({"tipo": "borda", "nome": nome_raw, "qty": 1, "sabores_raw": []})
            elif "sem borda" in nome_raw.lower(): continue   # "Sem Borda Recheada" nao e sabor
            elif eh_sabor_temx(nome_raw): continue
            elif eh_sabor_numerado(nome_raw): continue
            elif eh_pizza_salgada(nome_raw):
                c = {"tipo": "caixa_salgada", "nome": nome_raw, "qty": 1, "sabores_raw": []}; display.append(c); total_caixas += 1; cur_caixa = c
            elif eh_pizza_broto(nome_raw):
                c = {"tipo": "caixa_doce", "nome": nome_raw, "qty": 1, "sabores_raw": []}; display.append(c); total_caixas += 1; cur_caixa = c
            elif eh_bebida(nome_raw):
                display.append({"tipo": "bebida", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_bebidas += 1
            elif eh_sabor_doce(nome_raw):                      # broto doce sem prefixo "Pizza Broto de"
                if cur_caixa is not None and "broto" in (cur_caixa.get("nome") or "").lower() and not cur_caixa.get("sabores_raw"):
                    cur_caixa["tipo"] = "caixa_doce"           # v189: broto cujo SABOR é doce -> sabor DELE, promove a doce
                    cur_caixa["sabores_raw"].append((1, slots_do_tamanho(cur_caixa.get("nome") or "") or 1, abreviar_sabor(re.sub(r'^\d+\s+', '', nome_raw))))
                else:
                    c = {"tipo": "caixa_doce", "nome": nome_raw, "qty": 1, "sabores_raw": []}; display.append(c); total_caixas += 1; cur_caixa = c
            elif eh_adicional(nome_raw):                       # "Adicional de X" -> GRUDA na pizza ("+ X"), NAO fatia
                _add_adic(nome_raw, 1)
            elif _attach_sabor(nome_raw, 1):                   # "-Sabor" solto -> sabor da pizza atual
                pass
            elif nome_raw and len(nome_raw) > 2:
                display.append({"tipo": "outro", "nome": nome_raw, "qty": 1, "sabores_raw": []}); total_outros += 1
            continue
        if texto_limpo and len(texto_limpo) <= 25 and not texto_limpo.startswith("-"):
            texto_enc = corrigir_encoding(texto_limpo)
            if ultimo_tipo == "sabor" and display:
                for d in reversed(display):
                    if d["tipo"] in ("caixa_salgada", "caixa_doce") and d["sabores_raw"]:
                        n, de, sab = d["sabores_raw"][-1]
                        # v175: palavra cortada na quebra de linha (ex "SEM QU"+"EIJO") -> cola SEM
                        # espaco e SEM minusculizar; so poe espaco se nao for corte de palavra. Depois
                        # re-abrevia o sabor montado (pra "(SEM X)" remontado virar "s/ x" etc.).
                        corte = bool(re.search(r'[0-9A-Za-zÀ-ÿ]$', sab) and re.match(r'^[A-Za-zÀ-ÿ]', texto_enc))
                        novo = (sab + texto_enc) if corte else (sab + " " + texto_enc)
                        d["sabores_raw"][-1] = (n, de, abreviar_sabor(novo.strip())); break
            elif display:
                display[-1]["nome"] = limpar_nome(display[-1]["nome"] + texto_limpo)
    # v191: COMBO pedido Nx (qty>1) SEM marcador — o PAPEL do iFood lista o combo UMA vez e a qty do item
    # ("2  2x Pizza Grande + Refrigerante") era IGNORADA no ramo mult>1 -> saía 1 combo só (pedido #128 real
    # 20/06: 4 pizzas + 2 Cocas viravam 2 pizzas + 1 Coca). O KDS/comanda já corrigia isso desde v188 (emite
    # o combo qty vezes); a etiqueta não, pois a caixa do combo nasce com qty=1 no _alvo. Aqui replica os
    # itens do combo (pizzas + bebida + borda) qty vezes ANTES do split por slots. Combo COM marcador
    # (Brendi) fica de fora (combo_marker) -> pizzas já enumeradas, não re-multiplica.
    if combo_open is not None and combo_open[1] > 1 and not combo_marker:
        combo_segs.append((combo_open[0], len(display), combo_open[1]))
    for _s, _e, _q in sorted(combo_segs, reverse=True):
        _chunk = display[_s:_e]; _rep = []
        for _ in range(_q):
            for _d in _chunk:
                _nd = dict(_d); _nd["sabores_raw"] = list(_d.get("sabores_raw") or [])
                if "_adic" in _d: _nd["_adic"] = [list(_a) for _a in _d["_adic"]]
                _rep.append(_nd)
        display[_s:_e] = _rep
    # COMBO SEM MARCADOR (iFood: "2x Pizza Grande" + lista de "-1/2 X" SEM "Na Pizza"): a caixa fica com
    # qty>1 e TODAS as fatias empilhadas (consolidar somaria -> "3/2 Calabresa", bug pedido 168). Divide em
    # qty pizzas enchendo por SLOTS do tamanho (2 p/ Grande), igual ao split do colove. Combo COM marcador
    # (Brendi) ja saiu como caixas qty 1 -> nao entra aqui. Pizza unica (qty 1) tambem nao.
    # v189: nº de pizzas da caixa = o MAIOR entre a qty (combo iFood "2x", qty>1) e quantas pizzas as
    # fatias OCUPAM (ex.: 4 metades numa Grande de 2 slots = 2 pizzas). O 2º caso cobre o combo com
    # marcador só na 1ª pizza (pedido 227: 1 caixa qty=1 com 4 metades empilhadas -> divide em 2).
    _novo = []
    for d in display:
        _q = int(d.get("qty") or 1)
        if d.get("tipo") in ("caixa_salgada", "caixa_doce"):
            _raw = list(d.get("sabores_raw") or [])
            _sl = slots_do_tamanho(d.get("nome", "")) or 1
            _occ_tot = sum((int(_r[0]) if (isinstance(_r, (list, tuple)) and _r) else 1) for _r in _raw)
            _np = max(_q, (-(-_occ_tot // _sl)) if _sl else 1)   # ceil(ocupado/slots)
        else:
            _np = 1
        if d.get("tipo") in ("caixa_salgada", "caixa_doce") and _np > 1:
            _baldes = [[] for _ in range(_np)]; _cheio = [0] * _np; _ci = 0
            for _r in _raw:                                    # enche por SLOTS OCUPADOS (num): 2/2 ocupa 2, 1/2 ocupa 1
                _occ = int(_r[0]) if (isinstance(_r, (list, tuple)) and _r) else 1
                while _ci < _np - 1 and _cheio[_ci] >= _sl: _ci += 1
                _baldes[_ci].append(_r); _cheio[_ci] += _occ
            _base = next((b for b in _baldes if b), [])        # caixa vazia repete a 1a (combo de sabor unico)
            _adic = d.get("_adic")
            for _k in range(_np):
                _nd = dict(d); _nd["qty"] = 1
                _nd["sabores_raw"] = list(_baldes[_k] if _baldes[_k] else _base)
                _nd.pop("_adic", None)
                if _adic and _k == 0: _nd["_adic"] = _adic     # adicional (raro) fica na 1a pizza
                _novo.append(_nd)
        else:
            _novo.append(d)
    display = _novo
    for d in display:
        d["sabores"] = consolidar_sabores(d.get("sabores_raw", []))
        for nome, nota in d.get("_adic", []):                  # adicionais GRUDADOS na pizza, sem fracao
            d["sabores"].append(f"+ {nome}" + (f" ({nota})" if nota else ""))
        d.pop("_adic", None)
    return display, total_caixas, total_bebidas, total_outros

def extrair_numero_pedido(print_rows):
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'#(\d+)', texto)
        if m: return m.group(1)
        m2 = re.search(r'Pedido:\s*(\d+)', texto)
        if m2: return m2.group(1)
    return ""
def extrair_codigo_canal(print_rows):
    codigo = ""; canal = ""
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'(iFood|Brendi)\s*:\s*n.{0,3}:\s*(\d{3,5})', texto, re.IGNORECASE)
        if m: canal = m.group(1); codigo = m.group(2); continue
        m2 = re.search(r'C.?d\.?\s*no canal:\s*(\d{3,5})', texto)
        if m2: codigo = m2.group(1); continue
        m3 = re.search(r'Nome do canal:\s*(iFood|Brendi)', texto, re.IGNORECASE)
        if m3: canal = m3.group(1); continue
    return canal, codigo
def extrair_nome_cliente(print_rows):
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'Nome do cliente:\s*(.+)', texto)
        if m:
            partes = m.group(1).strip().split()
            if partes: return partes[0].upper()
    return ""
def extrair_hora_pedido(print_rows):
    for row in print_rows:
        texto = limpar_tags(row)
        m = re.search(r'Data/hora:\s*\S+\s*-\s*(\d{1,2}:\d{2})', texto)
        if m: return m.group(1)
    return ""

def extrair_valor_linha(linha):
    m = re.search(r'([\d]+[.,][\d]{2})\s*$', linha.strip())
    if m:
        val = m.group(1).replace(".", "").replace(",", ".")
        try: return float(val)
        except: pass
    return 0.0

def extrair_pagamento(print_rows):
    """
    Retorna tupla (categoria, dados)
    categoria: PAGO, MAQUINONA, DINHEIRO, DINHEIRO_TROCO, DIN_MAQUINONA
    dados: dict com valor, valor_pedido, valor_receber, valor_troco conforme categoria
    """
    todas_linhas = []
    for row in print_rows:
        texto = limpar_tags(row)
        if texto: todas_linhas.append(texto)
    texto_lower = " ".join(l.lower() for l in todas_linhas)

    # PRIORIDADE 1: COBRAR DO CLIENTE
    if "cobrar do cliente" in texto_lower:
        em_cobranca = False
        val_dinheiro = 0.0; val_maquinona = 0.0
        val_receber = 0.0; val_troco = 0.0
        tem_dinheiro = False; tem_troco = False; tem_maquinona = False

        for linha in todas_linhas:
            ll = linha.lower().strip()
            if "cobrar do cliente" in ll: em_cobranca = True; continue
            if not em_cobranca: continue
            if re.match(r'^(ifood|brendi|pizzaria|data|id da venda|op:|www|n.?\s*pedido)', ll): break
            val = extrair_valor_linha(linha)
            if ll.startswith("total"): continue

            if re.search(r'[Rr]eceber', linha) and val > 0:
                val_receber = val; continue
            if re.search(r'[Tt]roco', linha) and val > 0:
                tem_troco = True; val_troco = val; continue
            if val <= 0: continue

            if re.search(r'[Dd]inheiro', linha):
                tem_dinheiro = True; val_dinheiro += val; continue
            if re.search(r'[Dd].?bito', linha):
                tem_maquinona = True; val_maquinona += val; continue
            if re.search(r'[Cc]r.?dito', linha):
                tem_maquinona = True; val_maquinona += val; continue
            if re.search(r'[Pp]ix', linha):
                tem_maquinona = True; val_maquinona += val; continue
            if re.search(r'[Vv]oucher', linha):
                tem_maquinona = True; val_maquinona += val; continue

        # Classificar
        if tem_dinheiro and tem_maquinona:
            total = val_dinheiro + val_maquinona
            return "DIN_MAQUINONA", {"valor": total}
        if tem_dinheiro and tem_troco:
            return "DINHEIRO_TROCO", {
                "valor_pedido": val_dinheiro,
                "valor_receber": val_receber if val_receber > 0 else val_dinheiro,
                "valor_troco": val_troco
            }
        if tem_dinheiro:
            return "DINHEIRO", {"valor": val_dinheiro}
        if tem_maquinona:
            return "MAQUINONA", {"valor": val_maquinona}

    # PRIORIDADE 2: Pago online
    if "(pago)" in texto_lower or "pago online" in texto_lower or "pago pelo cliente" in texto_lower:
        return "PAGO", {}

    # PRIORIDADE 3: Dinheiro direto
    if "dinheiro" in texto_lower:
        val_dinheiro = 0.0
        for linha in todas_linhas:
            m = re.search(r'[Dd]inheiro\s+([\d.,]+)', linha)
            if m:
                val = m.group(1).replace(".", "").replace(",", ".")
                try: val_dinheiro = float(val)
                except: pass
        if "troco" in texto_lower:
            val_receber = 0.0; val_troco = 0.0
            for linha in todas_linhas:
                m = re.search(r'[Rr]eceber\s*:?\s*R?\$?\s*([\d.,]+)', linha)
                if m:
                    v = m.group(1).replace(".", "").replace(",", ".")
                    try: val_receber = float(v)
                    except: pass
            for linha in todas_linhas:
                m = re.search(r'[Tt]roco\s*:?\s*R?\$?\s*([\d.,]+)', linha)
                if m:
                    v = m.group(1).replace(".", "").replace(",", ".")
                    try: val_troco = float(v)
                    except: pass
            return "DINHEIRO_TROCO", {
                "valor_pedido": val_dinheiro,
                "valor_receber": val_receber if val_receber > 0 else val_dinheiro,
                "valor_troco": val_troco
            }
        return "DINHEIRO", {"valor": val_dinheiro}

    if "forma de pagamento" in texto_lower:
        return "MAQUINONA", {"valor": 0.0}

    return "", {}

def eh_retirada(print_rows):
    for row in print_rows:
        texto = limpar_tags(row).lower()
        if "retirada" in texto or "balc" in texto: return True
    return False

# ---- SALAO (mesa): formato de impressao DIFERENTE do delivery ----
def _salao_txt(row):
    return corrigir_encoding(limpar_tags(row))

def eh_salao(print_rows):
    """Salao tem cabecalho 'MESA MESA' e/ou linha 'Garcom:'. Delivery/retirada nao tem."""
    for r in print_rows:
        t = _salao_txt(r)
        if t.upper().startswith("MESA MESA"): return True
        if re.match(r'(?i)^gar.?om:', t): return True
    return False

def extrair_mesa(print_rows):
    for r in print_rows:
        m = re.match(r'(?i)^mesa:\s*(.+)$', _salao_txt(r))
        if m and m.group(1).strip(): return m.group(1).strip()
    return ""

def extrair_garcom(print_rows):
    for r in print_rows:
        m = re.match(r'(?i)^gar.?om:\s*(.+)$', _salao_txt(r))
        if m and m.group(1).strip(): return m.group(1).strip()
    return ""

def _sem_acento(s):
    for a, b in (("á","a"),("â","a"),("ã","a"),("à","a"),("é","e"),("ê","e"),("í","i"),
                 ("ó","o"),("ô","o"),("õ","o"),("ú","u"),("ç","c")):
        s = s.replace(a, b)
    return s

_CATALOGO_SALAO = None
def _carregar_catalogo_salao():
    global _CATALOGO_SALAO
    if _CATALOGO_SALAO is not None: return _CATALOGO_SALAO
    caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalogo_salao.json")
    try:
        with open(caminho, "r", encoding="utf-8") as f: _CATALOGO_SALAO = json.load(f)
    except Exception as e:
        log(f"  ERRO catalogo_salao.json: {e}")
        _CATALOGO_SALAO = {"por_codigo": {}, "por_texto": {}}
    return _CATALOGO_SALAO

def _norm_catalogo(texto):
    return re.sub(r'\s+', ' ', _sem_acento(corrigir_encoding(str(texto or '')).lower())).strip()

def _catalogo_salao_resolver(texto, codigo=None):
    cat = _carregar_catalogo_salao()
    candidatos = codigo if isinstance(codigo, (list, tuple)) else [codigo]
    for bruto in candidatos:
        cod = str(bruto or '').strip()
        if not cod: continue
        hit = cat.get("por_codigo", {}).get(cod) or cat.get("por_codigo", {}).get(cod.split('.')[-1])
        if hit: return hit
    return cat.get("por_texto", {}).get(_norm_catalogo(texto))

def _kds_desconhecido(display, nome, nota=""):
    aviso = f"⚠ Conferir: {nome}"
    if nota: aviso += f" ({nota})"
    display.append({"tipo": "outro", "nome": aviso, "qty": 1, "_fl": [], "_adic": []})

def _salao_eh_bebida(nome):
    # Detector de bebida COMPARTILHADO (salao + delivery/retirada/ficha — eh_bebida delega aqui).
    # Sem acento pra casar sempre. Palavras derivadas dos cardapios reais (Codigos de integracao.xlsx).
    # NAO inclui nome de fruta (morango/abacaxi/limao/uva) — colidem com sabores de pizza doce.
    n = _sem_acento(nome.lower())
    return any(b in n for b in [
        "caneca",                                                  # combo refil: "Caneca Individual de ..."
        "refri","coca cola","pepsi","guaran","fanta","sprite","del valle","kombucha","bally","pureza",
        "antarctica","tonica","agua","lata","refrigerante",        # refrigerantes / refis
        "chopp","cerveja","heineken","brahma","skol","budweiser","stella","corona","eisenbahn",
        "therez","original 600","long neck",                       # cervejas / chopp
        "vinho","taca","tinto","casillero","chandon","trivento","santa cristina","lunae",
        "espumante","prosecco","rolha",                            # vinhos / espumantes
        "caip","cuba libre","gin ","margarita","martini","drink",  # caipirinhas / drinks
        "bebida","suco","energetico","red bull","monster",
    ])

def _salao_marker_pizza(t):
    """Marcador de combo 'Na Pizza ...' (ex '1a Pizza 1/2 Calabresa'). Devolve (ordinal, resto)."""
    m = re.match(r'^(\d+).{0,2}?\s+pizza\s+(.+)$', t.strip(), re.IGNORECASE)
    if m: return int(m.group(1)), m.group(2).strip()
    return None, t

def extrair_itens_salao(print_rows):
    """Le os itens do salao. Trata: OBSERVACAO (** **) -> balao 'Obs:'; ADICIONAL ('Adicional de X')
    -> GRUDA na pizza como '+ X' (com nota se vier obs logo depois), NAO conta fatia; 'Sem Borda' ->
    ignora; BROTO DOCE -> caixa a parte; COMBO '2 X Pizza' -> divide em N pizzas pelos marcadores
    'Na Pizza' e le a fracao do texto. Sabor sem fracao = divide igual pelo numero de sabores."""
    display = []; in_items = False; em_obs = False; obs_acc = []
    cur = None; combo_nome = None; combo_doce = False; combo_pizzas = {}; pend_adic = None
    def _attach_flavor(nome):
        mf = re.match(r'^(\d+)/(\d+)\s+(.+)$', nome)
        if mf: num, den, sab = int(mf.group(1)), int(mf.group(2)), mf.group(3).strip()
        else: num, den, sab = 1, None, nome
        if cur is not None:
            cur["_fl"].append((num, den, abreviar_sabor(sab))); return True
        return False
    for r in print_rows:
        t = _salao_txt(r); low = t.lower()
        if "qt.descri" in low: in_items = True; continue
        if not in_items: continue
        if "quantidade de itens" in low:
            if em_obs: _flush_obs(display, obs_acc, pend_adic)
            break
        if not t: continue
        # OBSERVACAO (bloco ** ... **) — igual ao delivery; obs apos adicional vira a nota dele
        if em_obs and t.startswith("-"):
            _flush_obs(display, obs_acc, pend_adic); obs_acc = []; em_obs = False; pend_adic = None
        elif em_obs or t.startswith("**"):
            resto = t[2:] if (t.startswith("**") and not em_obs) else t
            if "**" in resto:
                antes = resto.split("**", 1)[0].strip()
                if antes: obs_acc.append(antes)
                _flush_obs(display, obs_acc, pend_adic); obs_acc = []; em_obs = False; pend_adic = None
            else:
                p = resto.strip()
                if p: obs_acc.append(p)
                em_obs = True
            continue
        # SUB-LINHA (numero opcional, x opcional)
        if t.startswith("-"):
            m = re.match(r'^-\s*(?:(\d+)\s*x?\s+)?(.+)$', t)
            if not m: pend_adic = None; continue
            qt = int(m.group(1)) if m.group(1) else 1
            nome = m.group(2).strip()
            if not nome: pend_adic = None; continue
            ordn, resto = _salao_marker_pizza(nome)                 # marcador de combo "Na Pizza ..."
            if ordn is not None and combo_nome:
                if ordn not in combo_pizzas:
                    p = {"tipo": "caixa_doce" if combo_doce else "caixa_salgada",
                         "nome": combo_nome, "qty": 1, "_fl": [], "_adic": []}
                    combo_pizzas[ordn] = p; display.append(p)
                cur = combo_pizzas[ordn]; nome = resto
                if not nome: pend_adic = None; continue
            low2 = nome.lower()
            if eh_pote_dip(nome):                               # potinho da borda dip = item proprio
                display.append({"tipo": "dip", "nome": nome_pote_dip(nome), "qty": qt, "_fl": [], "_adic": []}); pend_adic = None
            elif eh_borda(nome):
                display.append({"tipo": "borda", "nome": nome, "qty": qt, "_fl": [], "_adic": []}); pend_adic = None
            elif "sem borda" in low2:
                pend_adic = None; continue
            elif _salao_eh_bebida(nome):
                display.append({"tipo": "bebida", "nome": nome, "qty": qt, "_fl": [], "_adic": []}); pend_adic = None
            elif eh_adicional(nome):                                # "Adicional de X" -> "+ X" colado na pizza
                if cur is not None:
                    ad = [abreviar_sabor(nome), ""]; cur["_adic"].append(ad); pend_adic = ad
                else:
                    display.append({"tipo": "outro", "nome": nome, "qty": qt, "_fl": [], "_adic": []}); pend_adic = None
            elif (eh_pizza_broto(nome) or eh_sabor_doce(nome)) and (cur is None or (cur["tipo"] == "caixa_salgada" and "broto" not in cur["nome"].lower())):
                display.append({"tipo": "caixa_doce", "nome": nome, "qty": qt, "_fl": [], "_adic": []}); pend_adic = None   # broto solto SO se a pizza atual for grande/gigante (nao quando ela mesma e broto)
            elif eh_sabor_numerado(nome):
                pend_adic = None; continue
            else:
                pend_adic = None
                if cur is None and combo_nome:                      # combo sem marcador -> cria a 1a pizza
                    cur = {"tipo": "caixa_doce" if combo_doce else "caixa_salgada",
                           "nome": combo_nome, "qty": 1, "_fl": [], "_adic": []}
                    combo_pizzas[1] = cur; display.append(cur)
                if not _attach_flavor(nome):
                    display.append({"tipo": "outro", "nome": nome, "qty": qt, "_fl": [], "_adic": []})
            continue
        # ITEM DE TOPO "N  Nome"
        mi = re.match(r'^(\d+)\s+(.+)$', t)
        if mi:
            pend_adic = None
            qt = int(mi.group(1)); nome = mi.group(2).strip(); low2 = nome.lower()
            if "pizza" in low2 and not _salao_eh_bebida(nome):
                nome_clean = limpar_nome(nome)
                # combo "N X Pizza" (multiplicador separado): o regex de topo ja comeu o N -> sobra "X Pizza...".
                # Re-cola o N pra contar_pizzas_no_nome enxergar "NX Pizza" e dividir o combo certo (so dispara
                # quando sobra um "x " orfao no inicio; item normal "2 Pizza"/"Pizza ..." nao e afetado).
                if re.match(r'^x\s+', nome_clean, re.IGNORECASE):
                    nome_clean = f"{qt}{nome_clean}"; qt = 1
                mult = contar_pizzas_no_nome(nome_clean)
                base = re.sub(r'\s+sal[aã]o\b', '', nome_sem_combo(nome_clean), flags=re.IGNORECASE).strip()
                doce = eh_broto_doce(nome) or ("broto doce" in low2)
                if mult > 1:
                    combo_nome = base or "Pizza"; combo_doce = doce; combo_pizzas = {}; cur = None
                else:
                    combo_nome = None
                    cur = {"tipo": "caixa_doce" if doce else "caixa_salgada", "nome": base, "qty": qt, "_fl": [], "_adic": []}
                    display.append(cur)
            elif eh_pote_dip(nome):                             # potinho da borda dip = item proprio (nao vira alvo de sabor)
                display.append({"tipo": "dip", "nome": nome_pote_dip(nome), "qty": qt, "_fl": [], "_adic": []})
            elif eh_borda(nome):
                display.append({"tipo": "borda", "nome": nome, "qty": qt, "_fl": [], "_adic": []})
            elif _salao_eh_bebida(nome):
                display.append({"tipo": "bebida", "nome": nome, "qty": qt, "_fl": [], "_adic": []}); cur = None; combo_nome = None
            else:
                cur = {"tipo": "outro", "nome": nome, "qty": qt, "_fl": [], "_adic": []}; display.append(cur); combo_nome = None
            continue
    if em_obs: _flush_obs(display, obs_acc, pend_adic)
    out = []
    for d in display:
        fl = d.pop("_fl", []); ad = d.pop("_adic", []); sab = []
        if fl:
            tem_fr = any(den is not None for (_, den, _) in fl)
            if tem_fr:
                grupos = {}; ordem = []
                for num, den, nome in fl:
                    den = den or slots_do_tamanho(d["nome"]); k = (den, nome)
                    if k not in grupos: grupos[k] = 0; ordem.append(k)
                    grupos[k] += num
                for den, nome in ordem: sab.append(f"{grupos[(den, nome)]}/{den} {nome}")
            else:
                nomes = [n for (_, _, n) in fl]; ordem = []
                for n in nomes:
                    if n not in ordem: ordem.append(n)
                if len(ordem) == 1: sab = [ordem[0]]                # pizza inteira de 1 sabor
                else:
                    total = len(nomes)
                    for n in ordem: sab.append(f"{nomes.count(n)}/{total} {n}")
        for a in ad: sab.append(f"+ {a[0]}" + (f" ({a[1]})" if a[1] else ""))
        d["sabores"] = sab
        out.append(d)
    return out

# ============================================================================
# MODO KDS (robo): le o estruturado do Saipos (Firebase) e devolve o MESMO 'display'
# que extrair_itens_salao -> reusa agrupar_display + aplicar_regras_display + empurrar_comanda.
# Mesma estrutura, fonte diferente. So funcoes NOVAS (nao toca o caminho do papel). Validado: 17/17 casos do MANUAL.
# ============================================================================
_KDS_SWEET_ADIC = ["amendoim", "leite condensado", "coco ralado", "pacoca", "paçoca", "morango",
                   "abacaxi", "bombom beijinho", "bombom sonho de valsa", "sonho de valsa", "beijinho",
                   "sorvete de creme", "sorvete"]
def _kds_low(s):
    s = (s or "").lower()
    for a, b in [("á","a"),("à","a"),("â","a"),("ã","a"),("é","e"),("ê","e"),("í","i"),("ó","o"),("ô","o"),("õ","o"),("ú","u"),("ç","c")]:
        s = s.replace(a, b)
    return s
def _kds_eh_adic_doce(nome):
    x = _kds_low(nome); return any(a in x for a in [_kds_low(z) for z in _KDS_SWEET_ADIC])
def _kds_fl_sab(d):
    """_fl/_adic -> sabores. _fl pode ser (num,den,nome) OU (num,den,nome,nota): a nota do sabor
    vira '(obs: ...)' COLADA no proprio sabor (decisao do dono: obs colada no item)."""
    raw = d.get("_fl", []); ad = d.get("_adic", []); sab = []
    fl = [(t[0], t[1], t[2], (t[3] if len(t) > 3 else "")) for t in raw]
    def _comobs(s, notas):
        notas = [n for n in notas if n]
        return s + (" (obs: " + "; ".join(notas) + ")" if notas else "")
    if fl:
        tem_fr = any(den is not None for (_, den, _, _) in fl)
        if tem_fr:
            grupos = {}; gnotas = {}; ordem = []
            for num, den, nome, nota in fl:
                den = den or slots_do_tamanho(d["nome"]); k = (den, nome)
                if k not in grupos: grupos[k] = 0; gnotas[k] = []; ordem.append(k)
                grupos[k] += num
                if nota: gnotas[k].append(nota)
            for den, nome in ordem: sab.append(_comobs(f"{grupos[(den, nome)]}/{den} {nome}", gnotas[(den, nome)]))
        else:
            ordem = []; cnt = {}; gnotas = {}
            for _, _, nome, nota in fl:
                if nome not in ordem: ordem.append(nome); cnt[nome] = 0; gnotas[nome] = []
                cnt[nome] += 1
                if nota: gnotas[nome].append(nota)
            total = len(fl)
            if len(ordem) == 1: sab = [_comobs(ordem[0], gnotas[ordem[0]])]
            else:
                for nome in ordem: sab.append(_comobs(f"{cnt[nome]}/{total} {nome}", gnotas[nome]))
    bd = [f"Borda: {nome_borda_curto(bn)}" + (f" (obs: {bnt})" if bnt else "") for bn, bnt in d.get("_bordas", [])]
    sab = bd + sab   # borda do PROPRIO broto doce na frente (nao vira borda solta que iria pra salgada)
    for a in ad: sab.append(f"+ {a[0]}" + (f" ({a[1]})" if a[1] else ""))
    if d.get("_obs"): sab.append(f"Obs: {d['_obs']}")   # obs do PROPRIO item (ex.: broto doce) viaja junto, nao vira item "Obs:" solto
    return sab
def _kds_attach(cur, nome, nota=""):
    mf = re.match(r'^(\d+)/(\d+)\s+(.+)$', nome)
    if mf: num, den, sab = int(mf.group(1)), int(mf.group(2)), mf.group(3).strip()
    else: num, den, sab = 1, None, nome
    cur["_fl"].append((num, den, abreviar_sabor(sab), nota))
def _kds_classifica(display, cur, doce_ctx, texto, nota="", codigo=None):
    """Espelha o tratamento de sub-linha do extrair_itens_salao, lendo a escolha do KDS.
    nota = obs daquela escolha (lapis do Saipos) -> COLADA no item a que pertence (decisao do dono)."""
    nome = (texto or "").strip()
    if not nome: return
    if nome.startswith("⚠ Conferir:"):
        display.append({"tipo": "outro", "nome": nome, "qty": 1, "_fl": [], "_adic": []}); return
    low2 = nome.lower()
    if "sem borda" in low2: return
    info = _catalogo_salao_resolver(nome, codigo)
    if not info:
        _kds_desconhecido(display, nome, nota); return
    tipo = info.get("tipo") or "outro"; canon = info.get("nome") or nome
    if tipo == "dip":
        display.append({"tipo": "dip", "nome": nome_pote_dip(canon), "qty": 1, "_fl": [], "_adic": [], "_obs": nota})
    elif tipo == "borda":
        if cur is not None and cur.get("tipo") == "caixa_doce":
            cur.setdefault("_bordas", []).append((canon, nota))
        else:
            display.append({"tipo": "borda", "nome": canon, "qty": 1, "_fl": [], "_adic": [], "_obs": nota})
    elif tipo == "bebida":
        display.append({"tipo": "bebida", "nome": canon, "qty": 1, "_fl": [], "_adic": [], "_obs": nota})
    elif tipo == "adicional":
        if cur is not None: cur["_adic"].append([canon, nota])
        else: display.append({"tipo": "outro", "nome": canon, "qty": 1, "_fl": [], "_adic": [], "_obs": nota})
    elif tipo == "sabor_doce" and (cur is None or cur.get("tipo") != "caixa_doce"):
        caixa = {"tipo": "caixa_doce", "nome": "Pizza Broto", "qty": 1, "_fl": [], "_adic": [], "_obs": nota}
        _kds_attach(caixa, canon)
        display.append(caixa)
    elif tipo in ("sabor", "sabor_doce"):
        if cur is not None: _kds_attach(cur, canon, nota)
        else: _kds_desconhecido(display, canon, nota)
    else:
        _kds_desconhecido(display, canon, nota)
def _kds_frac(t):
    m = re.match(r'^(\d+)/(\d+)\s', (t or "").strip())
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)
def _kds_combo(display, base, doce, chs, mult, item_nota=""):
    """Combo 'Nx Pizza' lido do KDS estruturado. NAO existe 1/4: cada pizza e um GRUPO de escolha
    distinto (id_store_choice). Os sabores vem SEM marcador (delivery) ou com '1a Pizza ...' na 1a
    (salao), sempre em grupos diferentes. Entao: agrupa os sabores por grupo (1 grupo = 1 pizza, na
    ordem que aparecem), divide cada pizza em metades/tercos, anexa a borda da pizza certa (o marcador
    'Na Pizza' segue no nome da borda pro servidor casar) e poe a nota do sabor como 'Obs:'. Bebida /
    broto doce / sabor doce / adicional doce sao do combo todo -> viram refs (rodape)."""
    grupos_ordem = []          # ordem de aparicao das chaves de grupo -> 1 pizza cada
    grupo_fl = {}              # chave -> [(num, den, nome, nota)]  (nota = obs do sabor, colada nele)
    bordas = []                # [(ordn|None, gk, nome, nota)]
    adics = []                 # [(ordn|None, nome, nota)]
    extras = []                # textos -> _kds_classifica como ref (bebida/broto/doce)
    for ch in chs:
        if isinstance(ch, dict):
            txt = (ch.get("txt") or "").strip(); gk = ch.get("grp"); nota = (ch.get("notes") or "").strip(); codigos = ch.get("codigos")
        else:
            txt = str(ch or "").strip(); gk = None; nota = ""; codigos = None
        if not txt: continue
        ordn, resto = _salao_marker_pizza(txt)
        low = txt.lower()
        if "sem borda" in low: continue                             # "Sem Borda Recheada" = SEM borda -> nao e borda NEM sabor, pula (igual papel L793 e _kds_classifica L912)
        info = _catalogo_salao_resolver(txt, codigos) or _catalogo_salao_resolver(resto, codigos)
        if not info:
            extras.append((f"⚠ Conferir: {txt}", nota)); continue
        tipo = info.get("tipo") or "outro"; canon = info.get("nome") or txt
        if tipo in ("dip", "bebida") or (tipo == "sabor_doce" and not doce):
            extras.append((canon, nota)); continue
        if tipo == "borda":
            bordas.append((ordn, gk, canon, nota)); continue
        if tipo == "adicional":
            adics.append((ordn, canon, nota)); continue
        if tipo not in ("sabor", "sabor_doce"):
            extras.append((f"⚠ Conferir: {txt}", nota)); continue
        # SABOR: agrupa por grupo (chave = id_store_choice; senao ordinal/posicao)
        nome_sab = canon
        key = gk if gk is not None else (("ord", ordn) if ordn is not None else ("pos", len(grupos_ordem)))
        if key not in grupo_fl:
            grupos_ordem.append(key); grupo_fl[key] = []
        mf = re.match(r'^(\d+)/(\d+)\s+(.+)$', nome_sab)
        if mf: num, den, sab = int(mf.group(1)), int(mf.group(2)), mf.group(3).strip()
        else:  num, den, sab = 1, None, nome_sab
        grupo_fl[key].append((num, den, abreviar_sabor(sab), nota))   # nota = obs do sabor, colada nele
    n_pizzas = max(mult, len(grupos_ordem), 1)
    pizzas = []
    for i in range(n_pizzas):
        key = grupos_ordem[i] if i < len(grupos_ordem) else None
        pizzas.append((key, {"tipo": "caixa_doce" if doce else "caixa_salgada", "nome": base, "qty": 1,
                             "_fl": (grupo_fl[key] if key is not None else []), "_adic": []}))
    # adicionais: COM ordinal ("1a/2a Pizza") -> aquela pizza; SEM ordinal -> em TODAS as pizzas do combo
    # (decisao do dono: o adicional do combo pode ser de qualquer pizza, e montadores diferentes fazem cada
    # uma -> tem que aparecer em todas). Leva a nota do adicional junto.
    for ordn, nome, nota in adics:
        if ordn and 1 <= ordn <= n_pizzas:
            pizzas[ordn - 1][1]["_adic"].append([abreviar_sabor(nome), nota])
        else:
            for _k, _cx in pizzas: _cx["_adic"].append([abreviar_sabor(nome), nota])
    # bordas: por ordinal (1a/2a Pizza) -> senao pelo GRUPO (mesmo id_store_choice da pizza; delivery NAO
    # manda ordinal) -> senao por ordem de emissao (1 por pizza). Antes, sem ordinal TODAS caiam em bord_sem
    # e saiam DEPOIS de todas as pizzas -> no combo delivery a 1a pizza ficava sem borda e a ultima com 2.
    bord_por_pizza = {}; bord_sem = []; _bseq = 0
    for ordn, gk, nome, bnota in bordas:
        idx = None
        if ordn and 1 <= ordn <= n_pizzas: idx = ordn
        elif gk is not None and gk in grupos_ordem: idx = grupos_ordem.index(gk) + 1
        elif _bseq < n_pizzas: idx = _bseq + 1; _bseq += 1
        if idx is not None and 1 <= idx <= n_pizzas: bord_por_pizza.setdefault(idx, []).append((nome, bnota))
        else: bord_sem.append((nome, bnota))
    # EMITE: cada pizza -> caixa + borda (a nota do SABOR ja vai colada no proprio sabor; a da BORDA, na borda via _obs)
    for i, (key, cx) in enumerate(pizzas, start=1):
        display.append(cx)
        if item_nota:   # obs GERAL do pedido vai em CADA pizza do combo (montadores diferentes p/ a 1a e a 2a)
            display.append({"tipo": "outro", "nome": f"Obs: {item_nota}", "qty": 1, "_fl": [], "_adic": []})
        for nome, bnota in bord_por_pizza.get(i, []):
            display.append({"tipo": "borda", "nome": nome, "qty": 1, "_fl": [], "_adic": [], "_obs": bnota})
    for nome, bnota in bord_sem:
        display.append({"tipo": "borda", "nome": nome, "qty": 1, "_fl": [], "_adic": [], "_obs": bnota})
    # EXTRAS do combo (bebida / broto doce / sabor doce / adicional DOCE). O adicional doce gruda no
    # broto doce (igual o salgado gruda na pizza), virando "+ X" no card — antes caia solto como "outro".
    # Como no KDS o adicional pode vir ANTES ou DEPOIS do broto, segura os orfaos e gruda quando o broto
    # aparece; sobra sem nenhum broto doce -> outro (degradado, raro).
    cur_doce = None; adic_orfaos = []
    for txt, nota in extras:
        if (eh_adicional(txt) or _kds_eh_adic_doce(txt)) and not eh_pote_dip(txt) and not eh_pizza_broto(txt) and not _salao_eh_bebida(txt) and not eh_borda(txt):
            if cur_doce is not None: cur_doce["_adic"].append([abreviar_sabor(txt), nota])
            else: adic_orfaos.append((txt, nota))
            continue
        _before = len(display)
        _kds_classifica(display, None, True, txt, nota)   # bebida/broto: nota colada no proprio item (via _obs); NAO vira item "Obs:" solto que o split grudaria na salgada
        if len(display) > _before and display[-1].get("tipo") == "caixa_doce":
            cur_doce = display[-1]
            for o, onota in adic_orfaos: cur_doce["_adic"].append([abreviar_sabor(o), onota])
            adic_orfaos = []
    for o, onota in adic_orfaos:
        display.append({"tipo": "outro", "nome": o, "qty": 1, "_fl": [], "_adic": []})
def extrair_itens_kds(grupos):
    """Converte os grupos ativos do KDS (1 id_sale) no display do extrair_itens_salao."""
    display = []
    for g in grupos:
        itens = g.get("items") or {}
        it_iter = itens.values() if isinstance(itens, dict) else itens
        for it in it_iter:
            if not isinstance(it, dict) or str(it.get("deleted", "")).upper() == "Y": continue
            desc = (it.get("desc_sale_item") or "").strip()
            qty = max(1, int(it.get("quantity") or 1)); low = desc.lower()
            chs = []                                                   # [{txt, grp, notes}] — grp = id_store_choice (divide combo por pizza); notes = obs do sabor
            cis = it.get("choice_items") or {}
            ci_iter = cis.values() if isinstance(cis, dict) else cis
            for ci in ci_iter:
                if isinstance(ci, dict) and str(ci.get("deleted", "")).upper() != "Y":
                    txt = (ci.get("desc_sale_item_choice") or "").strip()
                    if txt:
                        obj = ci.get("choice_item") or {}
                        gk = obj.get("id_store_choice")
                        codigos = [ci.get("integration_code"), ci.get("codigo_integracao"),
                                   ci.get("id_store_choice_item"), obj.get("integration_code"),
                                   obj.get("id_store_choice_item")]
                        chs.append({"txt": txt, "grp": gk, "notes": (ci.get("notes") or "").strip(), "codigos": codigos})
            notes = (it.get("notes") or "").strip()
            if "pizza" in low:
                nome_clean = limpar_nome(desc); mult = contar_pizzas_no_nome(nome_clean)
                base = re.sub(r'\s+sal[aã]o\b', '', nome_sem_combo(nome_clean), flags=re.IGNORECASE).strip() or "Pizza"
                doce = eh_broto_doce(desc) or ("broto doce" in low)
                # broto cujo SABOR e doce (ex.: "Pizza Broto" + "Chocolate Mesclado", sem "Doce" no nome) = broto
                # DOCE. Sem isso o broto saia vazio (salgado), o sabor doce flutuava como caixa solta e a borda
                # ficava orfa. So promove se TODOS os sabores (fora borda/bebida/adicional) forem doces.
                if not doce and ("broto" in low or "brotinho" in low):
                    _sab = [c["txt"] for c in chs if not eh_pote_dip(c["txt"]) and not eh_borda(c["txt"]) and not _salao_eh_bebida(c["txt"]) and not eh_adicional(c["txt"])]
                    if _sab and all(eh_sabor_doce(s) for s in _sab): doce = True
                if mult > 1:
                    # v188: o combo pode ter sido pedido Nx (quantity>1). mult = pizzas POR combo (do nome
                    # "2 X Pizza"); qty = quantas vezes o combo foi pedido. Antes o qty era ignorado -> 1 combo
                    # so. Agora emite o combo qty vezes (ex.: "2x Pizza Grande+Coca" 2x -> 4 pizzas + 2 Cocas).
                    for _ in range(max(1, qty)):
                        _kds_combo(display, base, doce, chs, mult, notes)
                else:
                    # v193: pizza simples OU combo "1 pizza + bebida" (mult==1). Se pedido Nx (quantity>1),
                    # emite N pizzas iguais (qty=1 cada) + as escolhas (bebida etc.) N vezes — IGUAL ao ramo
                    # mult>1. Antes a pizza levava qty=N mas a BEBIDA/refs saiam 1x so (Coca de combo pedido
                    # 2x vinha qty=1) e total_caixas contava 1 item em vez de N. Ver pedido #11 (2 Gigantes+Refri).
                    for _ in range(qty):
                        cur = {"tipo": "caixa_doce" if doce else "caixa_salgada", "nome": base, "qty": 1, "_fl": [], "_adic": []}
                        display.append(cur)
                        for ch in chs:
                            _kds_classifica(display, cur, doce, ch["txt"], (ch.get("notes") or "").strip(), ch.get("codigos"))
                        if notes:
                            if doce: cur["_obs"] = notes   # broto doce: obs do item fica no broto (nao vira "Obs:" solto que iria pra salgada)
                            else: display.append({"tipo": "outro", "nome": f"Obs: {notes}", "qty": 1, "_fl": [], "_adic": []})
                # mult>1 (combo): a obs geral do pedido ja foi colada em CADA pizza dentro de _kds_combo
            elif eh_pote_dip(desc):                                    # potinho vendido como PRODUTO proprio no KDS
                display.append({"tipo": "dip", "nome": nome_pote_dip(desc), "qty": qty, "_fl": [], "_adic": [], "_obs": notes})
            elif _salao_eh_bebida(desc):
                display.append({"tipo": "bebida", "nome": desc, "qty": qty, "_fl": [], "_adic": []})
            else:
                cur = {"tipo": "outro", "nome": desc, "qty": qty, "_fl": [], "_adic": []}
                display.append(cur)
                for ch in chs: _kds_classifica(display, cur, False, ch["txt"], (ch.get("notes") or "").strip(), ch.get("codigos"))
    out = []
    for d in display:
        out.append({"tipo": d["tipo"], "nome": d["nome"], "qty": d["qty"], "sabores": _kds_fl_sab(d)})
    return out

def agrupar_display(display):
    resultado = []; i = 0
    while i < len(display):
        item = display[i]
        if item["tipo"] == "borda": resultado.append(dict(item)); i += 1; continue
        if item["tipo"] in ("caixa_salgada", "caixa_doce"):
            resultado.append(dict(item)); i += 1; continue
        nome = item["nome"]; qty_total = item["qty"]; j = i + 1
        while j < len(display) and display[j]["nome"] == nome and display[j]["tipo"] == item["tipo"]:
            qty_total += display[j]["qty"]; j += 1
        resultado.append({"tipo": item["tipo"], "nome": nome, "qty": qty_total, "sabores": item.get("sabores",[])}); i = j
    return resultado

def word_wrap(texto, draw, font, max_w):
    palavras = texto.split(); linhas = []; linha_atual = ""
    for palavra in palavras:
        teste = f"{linha_atual} {palavra}".strip() if linha_atual else palavra
        try: bb = draw.textbbox((0,0), teste, font=font); tw = bb[2]-bb[0]
        except: tw = len(teste)*10
        if tw <= max_w: linha_atual = teste
        else:
            if linha_atual: linhas.append(linha_atual)
            linha_atual = palavra
    if linha_atual: linhas.append(linha_atual)
    return linhas if linhas else [texto]

def formatar_valor(v):
    """Float -> string R$XX,XX"""
    try: return f"{v:.2f}".replace(".", ",")
    except: return "0,00"

def montar_rodape_linha(total_entrega, pag_cat, pag_dados):
    """Retorna UMA linha pro rodape: ITENS + pagamento (sem LEVAR em troco)"""
    if pag_cat == "PAGO":
        return f"ITENS: {total_entrega} - PAGO"
    if pag_cat == "MAQUINONA":
        return f"ITENS: {total_entrega} - MAQUINONA: R${formatar_valor(pag_dados.get('valor',0))}"
    if pag_cat == "DINHEIRO":
        return f"ITENS: {total_entrega} - DINHEIRO: R${formatar_valor(pag_dados.get('valor',0))}"
    if pag_cat == "DINHEIRO_TROCO":
        vp = pag_dados.get("valor_pedido", 0)
        vr = pag_dados.get("valor_receber", 0)
        return f"ITENS: {total_entrega} - DINHEIRO: R${formatar_valor(vp)} - TROCO PARA: R${formatar_valor(vr)}"
    if pag_cat == "DIN_MAQUINONA":
        return f"ITENS: {total_entrega} - DIN+MAQUINONA: R${formatar_valor(pag_dados.get('valor',0))}"
    if pag_cat in ("COBRAR_DETALHE", "PAGO_DETALHE"):
        prefixo = "PAGO - " if pag_cat == "PAGO_DETALHE" else ""
        return f"ITENS: {total_entrega} - {prefixo}{pag_dados.get('resumo', 'CONFIRMAR PAGAMENTO')}"
    return f"ITENS: {total_entrega}"

# ============================================================
# QR CODE embutido (v204) — sem biblioteca externa nos PCs.
# Gera QR modelo 2, versões 1–6, correção M, modo alfanumérico (0-9 A-Z espaço $%*+-./:)
# ou byte. Conferido módulo a módulo contra a biblioteca "qrcode" (tests/test_qr_mini.py).
# Conteúdo das etiquetas usa SÓ 0-9 e A-Z: a pistola "digita" como teclado e letras/números
# saem iguais em layout US e ABNT2 (símbolos como ":" e "/" trocam de tecla).
# ============================================================
_QR_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"
# (total de codewords, codewords de correção por bloco, [n blocos grupo1, dados/bloco g1, n g2, dados/bloco g2]) — nível M
_QR_M = {
    1: (26, 10, (1, 16, 0, 0)),
    2: (44, 16, (1, 28, 0, 0)),
    3: (70, 26, (1, 44, 0, 0)),
    4: (100, 18, (2, 32, 0, 0)),
    5: (134, 24, (2, 43, 0, 0)),
    6: (172, 16, (4, 27, 0, 0)),
}
_QR_ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]}

_GF_EXP = [0] * 512
_GF_LOG = [0] * 256
_x = 1
for _i in range(255):
    _GF_EXP[_i] = _x
    _GF_LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _GF_EXP[_i] = _GF_EXP[_i - 255]


def _gf_mul(a, b):
    if a == 0 or b == 0:
        return 0
    return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]]


def _rs_gerador(n):
    g = [1]
    for i in range(n):
        g2 = [0] * (len(g) + 1)
        for j, c in enumerate(g):
            g2[j] ^= c
            g2[j + 1] ^= _gf_mul(c, _GF_EXP[i])
        g = g2
    return g


def _rs_resto(dados, n):
    g = _rs_gerador(n)
    msg = list(dados) + [0] * n
    for i in range(len(dados)):
        coef = msg[i]
        if coef:
            for j in range(1, len(g)):
                msg[i + j] ^= _gf_mul(g[j], coef)
    return msg[len(dados):]


def _qr_bits(texto, versao):
    alnum = all(c in _QR_ALNUM for c in texto)
    bits = []

    def put(v, n):
        for i in range(n - 1, -1, -1):
            bits.append((v >> i) & 1)

    if alnum:
        put(0b0010, 4)
        put(len(texto), 9 if versao <= 9 else 11)
        for i in range(0, len(texto) - 1, 2):
            put(_QR_ALNUM.index(texto[i]) * 45 + _QR_ALNUM.index(texto[i + 1]), 11)
        if len(texto) % 2:
            put(_QR_ALNUM.index(texto[-1]), 6)
    else:
        dados = texto.encode("utf-8")
        put(0b0100, 4)
        put(len(dados), 8 if versao <= 9 else 16)
        for b in dados:
            put(b, 8)
    return bits


def _qr_capacidade_bits(versao):
    total, ec, (g1, d1, g2, d2) = _QR_M[versao]
    return (g1 * d1 + g2 * d2) * 8


def _qr_codewords(texto, versao):
    bits = _qr_bits(texto, versao)
    cap = _qr_capacidade_bits(versao)
    if len(bits) > cap:
        return None
    bits += [0] * min(4, cap - len(bits))
    bits += [0] * ((8 - len(bits) % 8) % 8)
    dados = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = [0xEC, 0x11]
    k = 0
    while len(dados) * 8 < cap:
        dados.append(pad[k % 2]); k += 1
    total, ec, (g1, d1, g2, d2) = _QR_M[versao]
    blocos, pos = [], 0
    for n, d in ((g1, d1), (g2, d2)):
        for _ in range(n):
            blocos.append(dados[pos:pos + d]); pos += d
    ecs = [_rs_resto(b, ec) for b in blocos]
    out = []
    for i in range(max(len(b) for b in blocos)):
        for b in blocos:
            if i < len(b): out.append(b[i])
    for i in range(ec):
        for e in ecs:
            out.append(e[i])
    return out


def _qr_formato(mascara):
    dados = (0b00 << 3) | mascara          # nível M = 00
    v = dados << 10
    for i in range(14, 9, -1):
        if v & (1 << i):
            v ^= 0b10100110111 << (i - 10)
    return ((dados << 10) | v) ^ 0b101010000010010


_QR_MASCARAS = [
    lambda r, c: (r + c) % 2 == 0,
    lambda r, c: r % 2 == 0,
    lambda r, c: c % 3 == 0,
    lambda r, c: (r + c) % 3 == 0,
    lambda r, c: (r // 2 + c // 3) % 2 == 0,
    lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
    lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
    lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
]


def _qr_base(versao):
    n = 17 + 4 * versao
    m = [[None] * n for _ in range(n)]

    def finder(r0, c0):
        for r in range(-1, 8):
            for c in range(-1, 8):
                rr, cc = r0 + r, c0 + c
                if 0 <= rr < n and 0 <= cc < n:
                    borda = r in (0, 6) or c in (0, 6)
                    miolo = 2 <= r <= 4 and 2 <= c <= 4
                    m[rr][cc] = 1 if (0 <= r <= 6 and 0 <= c <= 6 and (borda or miolo)) else 0
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0)
    for i in range(8, n - 8):
        m[6][i] = m[i][6] = 1 if i % 2 == 0 else 0
    pos = _QR_ALIGN[versao]
    for r in pos:
        for c in pos:
            if m[r][c] is not None:
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    m[r + dr][c + dc] = 1 if max(abs(dr), abs(dc)) != 1 else 0
    m[n - 8][8] = 1                          # módulo escuro fixo
    for i in range(9):                        # reserva área de formato
        if m[8][i] is None: m[8][i] = 0
        if m[i][8] is None: m[i][8] = 0
    for i in range(8):
        if m[8][n - 1 - i] is None: m[8][n - 1 - i] = 0
        if m[n - 1 - i][8] is None: m[n - 1 - i][8] = 0
    return m


def _qr_montar(codewords, versao, mascara):
    m = _qr_base(versao)
    n = len(m)
    livre = [[m[r][c] is None for c in range(n)] for r in range(n)]
    bits = []
    for cw in codewords:
        for i in range(7, -1, -1):
            bits.append((cw >> i) & 1)
    k = 0
    c = n - 1
    subindo = True
    while c > 0:
        if c == 6:
            c -= 1
        linhas = range(n - 1, -1, -1) if subindo else range(n)
        for r in linhas:
            for cc in (c, c - 1):
                if livre[r][cc]:
                    b = bits[k] if k < len(bits) else 0
                    k += 1
                    if _QR_MASCARAS[mascara](r, cc):
                        b ^= 1
                    m[r][cc] = b
        subindo = not subindo
        c -= 2
    f = _qr_formato(mascara)
    # grava o formato com a disposição padrão (ISO 18004, 7.9)
    for i in range(15):
        b = (f >> i) & 1
        if i < 6: r, cc = i, 8
        elif i < 8: r, cc = i + 1, 8
        elif i == 8: r, cc = 8, 7
        else: r, cc = 8, 14 - i
        m[r][cc] = b
        if i < 8: r2, c2 = 8, n - 1 - i
        else: r2, c2 = n - 15 + i, 8
        m[r2][c2] = b
    m[n - 8][8] = 1
    return m


def _qr_penalidade(m):
    n = len(m); p = 0
    for linhas in (m, [list(x) for x in zip(*m)]):
        for row in linhas:
            corrida = 1
            for i in range(1, n):
                if row[i] == row[i - 1]:
                    corrida += 1
                else:
                    if corrida >= 5: p += corrida - 2
                    corrida = 1
            if corrida >= 5: p += corrida - 2
            for i in range(n - 10):
                seg = row[i:i + 11]
                if seg == [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0] or seg == [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]:
                    p += 40
    for r in range(n - 1):
        for c in range(n - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                p += 3
    escuros = sum(map(sum, m))
    p += (abs(escuros * 20 - n * n * 10) // (n * n)) * 10
    return p


def qr_matriz(texto, mascara=None):
    """Matriz (lista de listas 0/1) do QR de `texto`, menor versão (1–6) que couber, nível M."""
    for versao in range(1, 7):
        cws = _qr_codewords(texto, versao)
        if cws is None:
            continue
        if mascara is not None:
            return _qr_montar(cws, versao, mascara)
        melhor = None
        for mk in range(8):
            mm = _qr_montar(cws, versao, mk)
            pen = _qr_penalidade(mm)
            if melhor is None or pen < melhor[0]:
                melhor = (pen, mm)
        return melhor[1]
    raise ValueError("texto grande demais para o QR da etiqueta")


def qr_imagem(texto, modulo=3, margem=2):
    """Imagem PIL (preto no branco) do QR, `modulo` px por quadradinho e `margem` módulos de borda."""
    m = qr_matriz(texto)
    n = len(m)
    lado = (n + 2 * margem) * modulo
    img = Image.new("1", (lado, lado), 1)
    px = img.load()
    for r in range(n):
        for c in range(n):
            if m[r][c]:
                for dy in range(modulo):
                    for dx in range(modulo):
                        px[(c + margem) * modulo + dx, (r + margem) * modulo + dy] = 0
    return img


QR_MODULO_PX = 4      # 4 px por quadradinho a 203 dpi = 0,5 mm (a pistola 2D le com folga)
QR_MARGEM_MOD = 2     # borda clara em volta (em quadradinhos)
QR_BORDA_DIR_PX = 0   # v210: QR colado na borda direita (cabeca da .14 tem pontos queimados no meio)
ETIQ_DESLOC_X_PX = 16 # v210: a .14 imprime ~2 mm pra esquerda; empurra a etiqueta da caixa pra direita
QR_BORDA_INF_PX = 4   # distancia do QR ate a borda de baixo

def gerar_etiqueta(numero_pedido, pizza_num, total_pizzas, display_items, total_entrega,
                   pag_cat, pag_dados, balcao, canal, codigo_canal, nome_cliente, hora_pedido,
                   qr_texto=None, unitario=False):
    """v14.4 - Rodape simetrico + N colunas adaptativas + distribuicao balanceada.
    v204: unitario=True -> o produto (pizza doce/salgada ou Pote Dip) ocupa o bloco principal;
    qr_texto -> QR no canto inferior direito (a faixa do rodape e o meio encolhem pra ele)."""
    img = Image.new("RGB", (LARGURA_PX, ALTURA_PX), "white")
    draw = ImageDraw.Draw(img)
    margem_e = 16
    margem_d = 16
    qr_img = None
    qr_lado = 0
    if qr_texto:
        try:
            qr_img = qr_imagem(qr_texto, modulo=QR_MODULO_PX, margem=QR_MARGEM_MOD)
            qr_lado = qr_img.size[0]
        except Exception as e:
            log(f"  QR nao gerado ({qr_texto}): {e}")
            qr_img = None; qr_lado = 0
    reserva_qr = (qr_lado + 6 + QR_BORDA_DIR_PX) if qr_img else 0
    LIMIAR_2COL = 16  # fonte minima aceitavel pra preferir 2 colunas

    def cf(tamanho):
        try: return ImageFont.truetype("arialbd.ttf", tamanho)
        except:
            try: return ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", tamanho)
            except: return ImageFont.load_default()

    # ============================================================
    # 1. Monta texto do HEADER
    # ============================================================
    try: num_padded = f"{int(numero_pedido):04d}"
    except: num_padded = numero_pedido or "0000"
    status = "PAGO" if str(pag_cat).startswith("PAGO") else "COBRAR"
    partes = [f"#{num_padded}", f"{pizza_num}/{total_pizzas}", status]
    if balcao and nome_cliente: partes.append(f"{nome_cliente} BALCAO")
    elif balcao: partes.append("BALCAO")
    elif codigo_canal: partes.append(codigo_canal)
    if hora_pedido: partes.append(hora_pedido)
    header_texto = " - ".join(partes)

    max_barra_w = LARGURA_PX - margem_e - 16

    # Auto-fit granular do header (1pt por vez)
    def auto_fit_1linha(texto, teto, piso=10, max_w=None):
        fs = piso
        lim = max_barra_w if max_w is None else max_w
        for sz in range(teto, piso - 1, -1):
            fh = cf(sz)
            try:
                bb = draw.textbbox((0,0), texto, font=fh)
                if (bb[2]-bb[0]) <= lim: fs = sz; break
            except: pass
        return fs

    fs_header = auto_fit_1linha(header_texto, teto=42, piso=14)

    def calc_h_barra(texto, fs):
        fh = cf(fs)
        try:
            bb = draw.textbbox((0,0), "Ag", font=fh); lh = (bb[3]-bb[1]) + 8
        except: lh = fs + 8
        return lh + 4

    h_header = calc_h_barra(header_texto, fs_header)

    # ============================================================
    # 2. Monta texto do RODAPE (simetria: teto = fs_header)
    # ============================================================
    linha_rodape = montar_rodape_linha(total_entrega, pag_cat, pag_dados)
    fs_rodape = auto_fit_1linha(linha_rodape, teto=fs_header, piso=10, max_w=max_barra_w - reserva_qr)
    h_rodape = calc_h_barra(linha_rodape, fs_rodape)

    # ============================================================
    # 3. Renderiza HEADER (faixa preta em cima)
    # ============================================================
    def render_barra(texto, y_start, h, fs, x_fim=LARGURA_PX):
        draw.rectangle([(0, y_start), (x_fim, y_start + h)], fill="black")
        fh = cf(fs)
        try:
            bb = draw.textbbox((0,0), texto, font=fh)
            y = y_start + (h - (bb[3]-bb[1]))//2 - 2
        except: y = y_start + 2
        draw.text((margem_e, y), texto, fill="white", font=fh)

    render_barra(header_texto, 0, h_header, fs_header)

    # ============================================================
    # 4. Separa itens em blocos: pizzas salgadas (com sabores e bordas juntas)
    #    vs fixo direita (brotos doces + bebidas + outros) com ORDEM fixa:
    #    outros -> brotos (penultimo) -> bebidas (ultimo)
    # ============================================================
    # Primeiro: anexa borda ao bloco da pizza salgada anterior
    # (Borda sempre vem depois da pizza a que se refere no Saipos)
    blocos_salgadas = []  # cada bloco: [(tipo, linha), ...]
    fixo_outros = []   # tipo "outro" (batata, sobremesa avulsa, etc)
    fixo_brotos = []   # tipo "caixa_doce" - penultimo na direita
    fixo_dips = []     # tipo "dip" (potinho da borda dip) - colado nas bebidas (regra do dono)
    fixo_bebidas = []  # tipo "bebida" - ultimo na direita
    for item in display_items:
        if item["tipo"] == "borda":
            if blocos_salgadas:
                blocos_salgadas[-1].append(("borda", f"Borda: {nome_borda_curto(item['nome'])}"))
            else:
                blocos_salgadas.append([("borda", f"Borda: {nome_borda_curto(item['nome'])}")])
        elif item["tipo"] == "caixa_salgada":
            bloco = []
            sabores = item.get("sabores", [])
            if sabores:
                bloco.append(("item", f"{item['qty']}x {item['nome']}:"))
                for s in sabores: bloco.append(("sabores", f"  {s}"))
            else:
                bloco.append(("item", f"{item['qty']}x {item['nome']}"))
            blocos_salgadas.append(bloco)
        elif unitario and item["tipo"] in ("caixa_doce", "dip"):
            # v204: etiqueta de UM produto -> o doce/pote e o bloco principal (esquerda, fonte grande)
            sabores = item.get("sabores", [])
            bloco = [("item", f"{item['qty']}x {item['nome']}:" if sabores else f"{item['qty']}x {item['nome']}")]
            for s in sabores: bloco.append(("sabores", f"  {s}"))
            blocos_salgadas.append(bloco)
        elif item["tipo"] == "caixa_doce":
            sabores = item.get("sabores", [])
            if sabores:
                fixo_brotos.append(("item", f"{item['qty']}x {item['nome']}:"))
                for s in sabores: fixo_brotos.append(("sabores", f"  {s}"))
            else:
                fixo_brotos.append(("item", f"{item['qty']}x {item['nome']}"))
        elif item["tipo"] == "dip":
            fixo_dips.append(("item", f"{item['qty']}x {item['nome']}"))
        elif item["tipo"] == "bebida":
            fixo_bebidas.append(("item", f"{item['qty']}x {item['nome']}"))
        elif item["tipo"] == "obs":  # v201: observacao em linha propria, sem quantidade
            fixo_outros.append(("item", item["nome"]))
        else:  # "outro"
            fixo_outros.append(("item", f"{item['qty']}x {item['nome']}"))

    # Ordem final da coluna direita: outros -> brotos -> dips -> bebidas (dip sempre perto do refri)
    fixo_dir = fixo_outros + fixo_brotos + fixo_dips + fixo_bebidas


    # ============================================================
    # 5. Escolhe N colunas (2-5) - prefere 2, sobe se fonte < LIMIAR
    # ============================================================
    y_meio = h_header + 4
    altura_meio = ALTURA_PX - h_rodape - y_meio - 4
    largura_total = LARGURA_PX - margem_e - margem_d - reserva_qr

    def wrap_col(col_raw, col_w, fi, fs, fb):
        out = []
        for tipo, txt in col_raw:
            fu = fi if tipo == "item" else (fb if tipo == "borda" else fs)
            for l in word_wrap(txt, draw, fu, col_w): out.append((tipo, l))
        return out

    def distribuir_balanceado(blocos, fixo, n):
        """Distribui blocos de pizzas salgadas em n colunas via greedy.
        Fixo (outros+brotos+bebidas) vai NO FINAL da ultima coluna, garantindo
        que a bebida seja sempre o ultimo item. O greedy considera o peso do
        fixo ao decidir pra onde cada pizza vai (pra manter balanceamento)."""
        if n <= 0: return []
        cols = [[] for _ in range(n)]
        fixo_len = len(fixo)
        for b in blocos:
            def custo(i):
                return len(cols[i]) + (fixo_len if i == n - 1 else 0)
            idx = min(range(n), key=custo)
            cols[idx].extend(b)
        cols[-1].extend(fixo)
        return cols

    def testar_n_colunas(n, max_fonte=42):
        if n <= 0: return 0, None
        col_w_n = largura_total // n
        col_max_w = col_w_n - 8
        cols = distribuir_balanceado(blocos_salgadas, fixo_dir, n)
        if any(len(c) == 0 for c in cols) and n > 2:
            return 0, None  # coluna vazia em 3+ eh desperdicio
        for sz in range(max_fonte, 9, -1):
            fi = cf(sz); fsab = cf(max(sz-1, 8)); fb = cf(max(sz-2, 8))
            try:
                bb = draw.textbbox((0,0), "Ag", font=fi); lh = (bb[3]-bb[1]) + 4
            except: lh = sz + 4
            cols_w = [wrap_col(c, col_max_w, fi, fsab, fb) for c in cols]
            max_linhas = max([len(c) for c in cols_w] + [1])
            if max_linhas * lh <= altura_meio:
                return sz, {
                    "n": n, "col_w": col_w_n, "cols_w": cols_w,
                    "lh": lh, "fi": fi, "fsab": fsab, "fb": fb
                }
        return 0, None

    # v204: etiqueta de um produto sem bebida/obs -> uma coluna so (fonte maior)
    sz1, dados1 = (testar_n_colunas(1) if (unitario and not fixo_dir) else (0, None))
    # Prefere 2 col se fonte >= LIMIAR; senao busca o N que da fonte maior
    sz2, dados2 = testar_n_colunas(2)
    if sz1 > 0:
        sz_itens, dados = sz1, dados1
    elif sz2 >= LIMIAR_2COL:
        sz_itens, dados = sz2, dados2
    else:
        melhor = (sz2, dados2) if sz2 > 0 else (0, None)
        for n in range(3, 6):
            sz, d = testar_n_colunas(n)
            if sz > melhor[0]:
                melhor = (sz, d)
        sz_itens, dados = melhor

    # ============================================================
    # 6. Renderiza o MEIO (colunas) e divisorias
    # ============================================================
    if dados:
        n = dados["n"]; col_w = dados["col_w"]; lh = dados["lh"]
        fi = dados["fi"]; fsab = dados["fsab"]; fb = dados["fb"]

        # Divisorias pontilhadas entre colunas
        for c in range(1, n):
            x_div = margem_e + col_w * c
            for dy in range(0, altura_meio, 6):
                draw.line([(x_div, y_meio+dy), (x_div, y_meio+dy+3)], fill="black", width=1)

        # Texto de cada coluna
        for i, col in enumerate(dados["cols_w"]):
            x_col = margem_e + col_w * i + (4 if i > 0 else 0)
            y = y_meio
            for tipo, txt in col:
                fu = fi if tipo == "item" else (fb if tipo == "borda" else fsab)
                draw.text((x_col, y), txt, fill="black", font=fu)
                y += lh

    # ============================================================
    # 7. Renderiza RODAPE (faixa preta embaixo)
    # ============================================================
    if qr_img:
        render_barra(linha_rodape, ALTURA_PX - h_rodape, h_rodape, fs_rodape, x_fim=LARGURA_PX - reserva_qr)
        x_qr = LARGURA_PX - qr_lado - QR_BORDA_DIR_PX
        y_qr = ALTURA_PX - qr_lado - QR_BORDA_INF_PX
        draw.rectangle([(x_qr - 2, y_qr - 2), (LARGURA_PX, ALTURA_PX)], fill="white")
        img.paste(qr_img.convert("RGB"), (x_qr, y_qr))
    else:
        render_barra(linha_rodape, ALTURA_PX - h_rodape, h_rodape, fs_rodape)

    return img



def imprimir_etiqueta(img, printer_name=None, larg=None, alt=None):
    """Imprime e devolve True/False (v202). Antes engolia o erro e ninguem sabia que falhou."""
    printer_name = printer_name or NOME_IMPRESSORA
    ok = False
    larg = larg if larg else LARGURA_PX
    alt = alt if alt else ALTURA_PX
    tmp = tempfile.NamedTemporaryFile(suffix=".bmp", delete=False); tmp_path = tmp.name; tmp.close()
    try:
        img.save(tmp_path, "BMP")
        with _print_lock:   # uma impressao por vez (watcher Saipos + poller Sofia compartilham a impressora)
            try:
                import win32print, win32ui; from PIL import ImageWin
            except ImportError:
                subprocess.run(f'mspaint /pt "{tmp_path}" "{printer_name}"', shell=True, capture_output=True, timeout=10)
                log("  Impresso OK (mspaint)")
                ok = True
            else:
                # Tenta de novo se a impressora 'tropecar' (comum no 1o job apos abrir/instalar).
                ultimo_erro = None
                for tentativa in range(4):
                    hdc = None
                    try:
                        hdc = win32ui.CreateDC(); hdc.CreatePrinterDC(printer_name)
                        if _eh_impressora_producao(printer_name):
                            # v206: a .24 tem o driver em 50x25 (CO LOVE); a caixa e' 80x30
                            dm = _devmode_papel(printer_name, LARGURA_MM, ALTURA_MM)
                            if dm is not None:
                                try:
                                    import win32gui; win32gui.ResetDC(hdc.GetSafeHdc(), dm)
                                except Exception as e: log(f"  ResetDC 80x30 ignorado: {e}")
                        hdc.StartDoc("Etiqueta Saipos"); hdc.StartPage()
                        dx = 0
                        if img.size == (LARGURA_PX, ALTURA_PX) and ETIQ_DESLOC_X_PX:
                            # v210: so a etiqueta da caixa; nunca empurra alem da area que o driver imprime
                            try:
                                import win32con
                                area = hdc.GetDeviceCaps(win32con.HORZRES)
                                dx = max(0, min(ETIQ_DESLOC_X_PX, area - larg))
                                if tentativa == 0: log(f"  area impressao {area}px, etiqueta {larg}px, desloc {dx}px")
                            except Exception: dx = 0
                        ImageWin.Dib(img).draw(hdc.GetHandleOutput(), (dx, 0, larg + dx, alt))
                        hdc.EndPage(); hdc.EndDoc(); hdc.DeleteDC()
                        log(f"  Impresso OK ({printer_name})")
                        ultimo_erro = None
                        ok = True
                        break
                    except Exception as e:
                        ultimo_erro = e
                        if hdc:
                            try: hdc.DeleteDC()
                            except Exception: pass
                        if tentativa < 3:
                            log(f"  impressora ocupada, tentando de novo ({tentativa+1}/4)...")
                            time.sleep(1.2)
                if ultimo_erro is not None:
                    log(f"  ERRO: {ultimo_erro}")
    except Exception as e: log(f"  ERRO: {e}")
    finally:
        try: time.sleep(2); os.unlink(tmp_path)
        except: pass
    return ok

def processar_nfce(filepath, filename):
    data = ler_arquivo_saipos(filepath)
    if not data: return
    if isinstance(data, dict): data = [data]
    for el in data:
        rows = el.get("printRows", []); debug_save(filename, rows)
        id_sale = str(el.get("id_sale", ""))
        if not id_sale:
            for row in rows:
                m = re.search(r'ID:\s*(\d+)', limpar_tags(row))
                if m: id_sale = m.group(1); break
        cat, dados = extrair_pagamento(rows); bal = eh_retirada(rows)
        cn, cd = extrair_codigo_canal(rows); nc = extrair_nome_cliente(rows); hr = extrair_hora_pedido(rows)
        if id_sale and (cat or cd):
            cache_pagamento[id_sale] = {"pag_cat":cat,"pag_dados":dados,"balcao":bal,
                                        "canal":cn,"codigo_canal":cd,"nome_cliente":nc,"hora":hr}
            log(f"  NFCe: {id_sale} -> {cat} canal={cd}")
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
    except: pass

def processar_pedido(filepath, filename):
    data = ler_arquivo_saipos(filepath)
    if not data: log(f"  Parse falhou"); return
    if isinstance(data, dict): data = [data]
    id_sale = ""
    for el in data:
        s = str(el.get("id_sale", ""))
        if s: id_sale = s; break
    if id_sale and id_sale in processados_id_sale:
        elapsed = time.time() - processados_id_sale[id_sale]
        if elapsed < 30:
            log(f"  Dedup: {id_sale} ({elapsed:.0f}s atras)")
            try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
            except: pass
            return
        else:
            log(f"  Reimpressao: {id_sale} ({elapsed:.0f}s atras)")

    # ---- SALAO: o Saipos imprime a comanda fisica; aqui NAO imprime etiqueta, so manda
    #      pra fila virtual marcado como SALAO (com a Mesa). Formato de itens e diferente. ----
    rows_all = []
    for el in data: rows_all.extend(el.get("printRows", []))
    if eh_salao(rows_all):
        for el in data: debug_save(filename, el.get("printRows", []))
        mesa = extrair_mesa(rows_all); garcom = extrair_garcom(rows_all)
        hora = extrair_hora_pedido(rows_all); display = agrupar_display(extrair_itens_salao(rows_all))
        tcx = sum(d["qty"] for d in display if d["tipo"] in ("caixa_salgada", "caixa_doce"))
        tent = sum(d["qty"] for d in display)
        log(f"  SALAO Mesa {str(mesa)[:24]}: {tcx}cx {tent}itens (sem etiqueta)")
        if id_sale: processados_id_sale[id_sale] = time.time()
        try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename)); log("  Movido (salao)")
        except: pass
        empurrar_comanda(mesa, aplicar_regras_display(display, "comanda"), tcx, tent, "", False, "", "", garcom, hora, id_sale,
                         force_order_type="SALAO", label_printed=False)
        empurrar_debug(id_sale, mesa, "SALAO", "", "", rows_all, display,
                       {"caixas": tcx,
                        "bebidas": sum(d["qty"] for d in display if d["tipo"] == "bebida"),
                        "outros": sum(d["qty"] for d in display if d["tipo"] == "outro"),
                        "entrega": tent},
                       {"mesa": mesa, "garcom": garcom, "hora": hora})
        return

    el_cozinha = []; el_caixa = []
    for el in data:
        rows = el.get("printRows", []); debug_save(filename, rows)
        if eh_elemento_cozinha(el): el_cozinha.append(el)
        else: el_caixa.append(el)
    log(f"  {len(el_cozinha)} cozinha, {len(el_caixa)} caixa")

    pag_cat = ""; pag_dados = {}; balcao = False
    canal = ""; codigo_canal = ""; nome_cliente = ""; hora_pedido = ""
    for el in el_caixa:
        rows = el.get("printRows", [])
        c, d = extrair_pagamento(rows)
        if c: pag_cat = c; pag_dados = d
        if eh_retirada(rows): balcao = True
        cn, cd = extrair_codigo_canal(rows)
        if cd: canal = cn; codigo_canal = cd
        nc = extrair_nome_cliente(rows)
        if nc: nome_cliente = nc
        hr = extrair_hora_pedido(rows)
        if hr: hora_pedido = hr

    if not pag_cat:
        for el in el_cozinha:
            rows = el.get("printRows", []); c, d = extrair_pagamento(rows)
            if c: pag_cat = c; pag_dados = d
            if eh_retirada(rows): balcao = True
    if not codigo_canal:
        for el in el_cozinha:
            cn, cd = extrair_codigo_canal(el.get("printRows", []))
            if cd: canal = cn; codigo_canal = cd
    if not nome_cliente:
        for el in el_cozinha:
            nc = extrair_nome_cliente(el.get("printRows", []))
            if nc: nome_cliente = nc
    if not hora_pedido:
        for el in el_cozinha:
            hr = extrair_hora_pedido(el.get("printRows", []))
            if hr: hora_pedido = hr
    for el in el_cozinha:
        if eh_retirada(el.get("printRows", [])): balcao = True

    if not pag_cat or not codigo_canal:
        if id_sale and id_sale in cache_pagamento:
            cached = cache_pagamento[id_sale]
            if not pag_cat: pag_cat = cached.get("pag_cat", ""); pag_dados = cached.get("pag_dados", {})
            balcao = balcao or cached.get("balcao", False)
            if not codigo_canal: codigo_canal = cached.get("codigo_canal", ""); canal = cached.get("canal", "")
            if not nome_cliente: nome_cliente = cached.get("nome_cliente", "")
            if not hora_pedido: hora_pedido = cached.get("hora", "")
            log(f"  Cache: {pag_cat} canal={codigo_canal}")
        else:
            log(f"  Aguardando NFCe (5s)..."); time.sleep(5)
            if id_sale and id_sale in cache_pagamento:
                cached = cache_pagamento[id_sale]
                if not pag_cat: pag_cat = cached.get("pag_cat", ""); pag_dados = cached.get("pag_dados", {})
                balcao = balcao or cached.get("balcao", False)
                if not codigo_canal: codigo_canal = cached.get("codigo_canal", ""); canal = cached.get("canal", "")
                if not nome_cliente: nome_cliente = cached.get("nome_cliente", "")
                if not hora_pedido: hora_pedido = cached.get("hora", "")
                log(f"  Cache NFCe: {pag_cat} canal={codigo_canal}")

    if id_sale: processados_id_sale[id_sale] = time.time()

    # FILTRO (Lucas 18/09/26): so retirada criada DIRETO no Saipos (canal vazio) segue. ENTREGA e
    # retirada de canal online (iFood/Brendi/menu proprio) vao pelo Provisao -> bloqueia (sem etiqueta, sem Mana).
    _bloqueado = False
    _motivo = ""
    if not balcao:
        _bloqueado = True; _motivo = "ENTREGA"
    else:
        _txt = " ".join(limpar_tags(r).lower() for r in rows_all)
        _canal_online = ((canal or "").strip().lower() in ("ifood", "brendi")
                         or "menu proprio" in _txt or "menu próprio" in _txt
                         or "site proprio" in _txt or "site próprio" in _txt)
        if _canal_online:
            _bloqueado = True; _motivo = "RETIRADA canal " + (canal or "menu proprio")
    if _bloqueado:
        log(f"  BLOQUEADO ({_motivo}): #{id_sale} sem etiqueta, sem Mana (vai pelo Provisao).")
        try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
        except: pass
        return

    # ITENS do CAIXA
    el_itens = el_caixa if el_caixa else el_cozinha
    all_display = []; numero_pedido = ""
    for el in el_itens:
        rows = el.get("printRows", []); num = extrair_numero_pedido(rows)
        if num: numero_pedido = num
        display, cx, bb, ou = extrair_itens_printrows(rows); all_display.extend(display)
    if not numero_pedido:
        for el in (el_cozinha if el_caixa else el_caixa):
            num = extrair_numero_pedido(el.get("printRows", []))
            if num: numero_pedido = num; break

    all_display = agrupar_display(all_display)
    total_caixas = sum(d["qty"] for d in all_display if d["tipo"] in ("caixa_salgada", "caixa_doce"))
    total_bebidas = sum(d["qty"] for d in all_display if d["tipo"] == "bebida")
    total_outros = sum(d["qty"] for d in all_display if d["tipo"] == "outro")
    total_dips = sum(d["qty"] for d in all_display if d["tipo"] == "dip")   # potinhos da borda dip
    total_entrega = total_caixas + total_bebidas + total_outros + total_dips

    log(f"  #{numero_pedido}: {total_caixas}cx {total_dips}dip {total_bebidas}beb {total_outros}out = {total_entrega} | {pag_cat} | canal={codigo_canal} | {'BALCAO' if balcao else 'ENTREGA'} | {nome_cliente} | {hora_pedido}")

    if total_caixas == 0 and total_entrega == 0:
        log(f"  Sem itens")
        try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
        except: pass
        return

    impressora_cx = _impressora_caixas()
    display_etiqueta = aplicar_regras_display(all_display, "etiqueta")  # no-op se o dicionario estiver desligado
    # potinho da borda dip conta ETIQUETA propria (cola na embalagem do pote), igual pizza.
    # total_caixas continua so pizzas (o servidor/comanda usa como nº de pizzas).
    num_etiquetas = max(total_caixas + total_dips, 1)
    for i in range(1, num_etiquetas + 1):
        img = gerar_etiqueta(numero_pedido, i, num_etiquetas, display_etiqueta, total_entrega,
                             pag_cat, pag_dados, balcao, canal, codigo_canal, nome_cliente, hora_pedido)
        log(f"  Etiqueta {i}/{num_etiquetas}..."); imprimir_etiqueta(img, printer_name=impressora_cx)
        if i < num_etiquetas: time.sleep(0.5)
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename)); log(f"  Movido")
    except: pass
    log(f"  OK #{numero_pedido} - {num_etiquetas} etiqueta(s)!")
    # CO LOVE: alem de imprimir, manda o pedido pra fila dos pizzaiolos (best-effort, so se ligado)
    empurrar_comanda(numero_pedido, aplicar_regras_display(all_display, "comanda"), total_caixas, total_entrega,
                     pag_cat, balcao, canal, codigo_canal, nome_cliente, hora_pedido, id_sale)
    # CO LOVE: manda a "foto" crua do pedido pra IA diaria (best-effort, so se ligado no servidor)
    empurrar_debug(id_sale, numero_pedido, _comanda_order_type(balcao, codigo_canal),
                   canal, codigo_canal, rows_all, all_display,
                   {"caixas": total_caixas, "dips": total_dips, "bebidas": total_bebidas, "outros": total_outros, "entrega": total_entrega},
                   {"cliente_nome": nome_cliente, "pag_cat": pag_cat, "hora": hora_pedido, "balcao": balcao})

def processar_arquivo(filepath):
    filename = os.path.basename(filepath)
    if filename in processados_arquivos and (time.time() - processados_arquivos[filename]) < 30: return
    processados_arquivos[filename] = time.time(); log(f"Arquivo: {filename}")
    if filename.lower().startswith("nfce_"): processar_nfce(filepath, filename); return
    processar_pedido(filepath, filename)

# ============================================================
# CO LOVE - Etiquetas de Producao (.lovelabel)
# ============================================================
_LOVELABEL_SEEN = {}
_LOVELABEL_DEDUP_S = 5

# --- Impressoras achadas pelo IP FIXO na rede (o nome no Windows varia por PC) ---
# Caixas (comandas) 80x30mm  e  Producao do CO LOVE 50x25mm sao 2 impressoras de rede.
IP_IMPRESSORA_CAIXAS   = "192.168.1.14"   # etiquetas das caixas de pizza (80x30)
IP_IMPRESSORA_PRODUCAO = "192.168.1.24"   # etiquetas de validade CO LOVE (50x25)
IP_IMPRESSORA_COMANDA  = "192.168.1.222"  # comanda em cupom estilo Saipos (Elgin i8, 80mm)

CO_LOVE_LARGURA_MM = 50
CO_LOVE_ALTURA_MM = 25
CO_LOVE_LARGURA_PX = int(CO_LOVE_LARGURA_MM * DPI / 25.4)   # ~399 px @ 203 DPI
CO_LOVE_ALTURA_PX = int(CO_LOVE_ALTURA_MM * DPI / 25.4)     # ~199 px @ 203 DPI

_cache_impressora_ip = {}

def _ip_da_porta(port_name):
    """Descobre o IP de uma porta de impressora (pelo nome da porta ou pelo registro)."""
    m = re.search(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', port_name or "")
    if m: return m.group(1)
    try:
        import winreg
        base = r"SYSTEM\CurrentControlSet\Control\Print\Monitors\Standard TCP/IP Port\Ports"
        chave = base + "\\" + (port_name or "")
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, chave) as k:
            for nome_valor in ("IPAddress", "HostName"):
                try:
                    v, _ = winreg.QueryValueEx(k, nome_valor)
                    mm = re.search(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', str(v))
                    if mm: return mm.group(1)
                except Exception:
                    continue
    except Exception:
        pass
    return None

def _achar_impressora_por_ip(ip):
    try:
        import win32print
    except Exception:
        return None
    try:
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        impressoras = win32print.EnumPrinters(flags, None, 2)
    except Exception as e:
        log(f"  erro lendo impressoras: {e}")
        return None
    for p in impressoras:
        if _ip_da_porta(p.get("pPortName", "")) == ip:
            return p.get("pPrinterName", "")
    return None

def _impressora_para(ip, fallback=None, etiqueta=""):
    """Nome (Windows) da impressora que esta no IP dado. Cacheia so o sucesso."""
    nome = _cache_impressora_ip.get(ip)
    if nome: return nome
    nome = _achar_impressora_por_ip(ip)
    if nome:
        _cache_impressora_ip[ip] = nome
        log(f"  {etiqueta}: impressora '{nome}' (IP {ip})")
        return nome
    log(f"  {etiqueta}: nenhuma impressora no IP {ip} -> usando '{fallback}'")
    return fallback

# v206: .14 (caixas) parada -> etiquetas das caixas vao pra impressora de PRODUCAO (.24),
# com o papel FORCADO em 80x30 (o rolo da .24 foi trocado pra 80x30). Temporario e automatico:
# quando a .14 voltar a responder na rede, as etiquetas voltam sozinhas pra ela.
# O spooler do Windows aceita o job mesmo com a impressora desligada ("printed" != papel saiu),
# por isso a vida da impressora e' testada direto na porta de impressao (9100).
# "auto" = .14 se responde, senao .24 | "sempre" = sempre .24 | "nunca" = comportamento antigo
CAIXAS_NA_PRODUCAO = "nunca"    # v209: .14 consertada (25/09) — caixas de volta na .14
_vida_ip = {}   # ip -> (quando_testou, respondeu)

def _ip_responde(ip, porta=9100, timeout=1.5, cache_s=60):
    agora = time.time()
    c = _vida_ip.get(ip)
    if c and agora - c[0] < cache_s:
        return c[1]
    try:
        import socket
        with socket.create_connection((ip, porta), timeout=timeout):
            vivo = True
    except Exception:
        vivo = False
    _vida_ip[ip] = (agora, vivo)
    return vivo

def _nome_por_ip(ip):
    """Igual _impressora_para, mas quieto quando nao acha (roda a cada pedido/minuto)."""
    nome = _cache_impressora_ip.get(ip)
    if not nome:
        nome = _achar_impressora_por_ip(ip)
        if nome: _cache_impressora_ip[ip] = nome
    return nome

_caixas_ultima = None
def _impressora_caixas(fallback=NOME_IMPRESSORA):
    """Nome da impressora das etiquetas das caixas (ver CAIXAS_NA_PRODUCAO)."""
    global _caixas_ultima
    nome14 = _nome_por_ip(IP_IMPRESSORA_CAIXAS)
    escolha = nome14 or fallback
    if CAIXAS_NA_PRODUCAO != "nunca":
        usar_24 = CAIXAS_NA_PRODUCAO == "sempre" or not _ip_responde(IP_IMPRESSORA_CAIXAS)
        if usar_24:
            nome24 = _nome_por_ip(IP_IMPRESSORA_PRODUCAO) or _instalar_impressora_24()
            if nome24 and (CAIXAS_NA_PRODUCAO == "sempre" or _ip_responde(IP_IMPRESSORA_PRODUCAO)):
                escolha = nome24
    if escolha != _caixas_ultima:
        onde = "PRODUCAO .24 (papel 80x30)" if escolha and escolha == _cache_impressora_ip.get(IP_IMPRESSORA_PRODUCAO) else "CAIXAS .14"
        log(f"  CAIXAS: etiquetas das caixas indo pra '{escolha}' -> {onde}")
        try: sofia_evento("caixas_impressora", impressora=escolha, detalhe=onde)
        except Exception: pass
        _caixas_ultima = escolha
    return escolha

NOME_PRODUCAO_AUTO = "producao 24 (etiquetas)"
_instalou_24 = [0]
def _instalar_impressora_24():
    """v208: PC sem a .24 no Windows -> cria a porta TCP 192.168.1.24 e a impressora,
    com o MESMO driver da impressora das caixas (Elgin L42PRO). Tenta no max 1x a cada 10 min."""
    if time.time() - _instalou_24[0] < 600: return None
    _instalou_24[0] = time.time()
    try:
        import win32print
        driver = None
        for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS, None, 2):
            if _ip_da_porta(p.get("pPortName", "")) == IP_IMPRESSORA_CAIXAS or "L42" in (p.get("pDriverName") or "").upper():
                driver = p.get("pDriverName"); break
        if not driver:
            sofia_evento("instalar_24", detalhe="sem driver Elgin neste PC"); return None
        ip = IP_IMPRESSORA_PRODUCAO; porta = f"IP_{ip}"
        ps = (f"$ErrorActionPreference='Stop';"
              f"if(-not (Get-PrinterPort -Name '{porta}' -EA SilentlyContinue)){{Add-PrinterPort -Name '{porta}' -PrinterHostAddress '{ip}'}};"
              f"if(-not (Get-Printer -Name '{NOME_PRODUCAO_AUTO}' -EA SilentlyContinue)){{Add-Printer -Name '{NOME_PRODUCAO_AUTO}' -DriverName '{driver}' -PortName '{porta}'}}")
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=60)
        msg = (r.stderr or r.stdout or "").strip()[:300]
        log(f"  PRODUCAO: instalando impressora na .24 (driver '{driver}') -> {'OK' if r.returncode == 0 else 'FALHOU: ' + msg}")
        sofia_evento("instalar_24", detalhe=("ok " + driver) if r.returncode == 0 else ("falhou: " + msg))
        _cache_impressora_ip.pop(ip, None)
        return _nome_por_ip(ip) if r.returncode == 0 else None
    except Exception as e:
        log(f"  PRODUCAO: instalar .24 falhou: {e}")
        sofia_evento("instalar_24", detalhe=f"erro: {e}")
        return None

_diag_feito = [False]
def _diagnostico_impressoras():
    """v208: sobe pra nuvem as impressoras do PC (nome, porta/IP, driver, status). 1x por boot."""
    if _diag_feito[0]: return
    _diag_feito[0] = True
    try:
        import win32print
        for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS, None, 2):
            sofia_evento("impressora_pc", impressora=p.get("pPrinterName"),
                         detalhe=f"porta={p.get('pPortName')} ip={_ip_da_porta(p.get('pPortName',''))} driver={p.get('pDriverName')} status={p.get('Status')} attr={p.get('Attributes')} jobs={p.get('cJobs')}")
    except Exception as e:
        sofia_evento("impressora_pc", detalhe=f"erro: {e}")
    for ip in (IP_IMPRESSORA_CAIXAS, IP_IMPRESSORA_PRODUCAO, IP_IMPRESSORA_COMANDA):
        _vida_ip.pop(ip, None)
        sofia_evento("impressora_rede", detalhe=f"{ip}:9100 {'responde' if _ip_responde(ip) else 'NAO responde'}")

def _eh_impressora_producao(printer_name):
    return bool(printer_name) and printer_name == _cache_impressora_ip.get(IP_IMPRESSORA_PRODUCAO)

def _prod_fonte_bold(tamanho):
    for p in ("arialbd.ttf", "C:\\Windows\\Fonts\\arialbd.ttf",
              "/Library/Fonts/Arial Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try: return ImageFont.truetype(p, tamanho)
        except: continue
    return ImageFont.load_default()

def _prod_fonte_normal(tamanho):
    for p in ("arial.ttf", "C:\\Windows\\Fonts\\arial.ttf",
              "/Library/Fonts/Arial.ttf",
              "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try: return ImageFont.truetype(p, tamanho)
        except: continue
    return ImageFont.load_default()

def _prod_data_br(iso_str):
    try:
        y, m, d = iso_str.split("-")
        return f"{d}/{m}/{y}"
    except: return iso_str or ""

def _prod_hora_br(iso_str):
    """Extrai HH:MM de um timestamp ISO (printed_at) convertendo pra America/Sao_Paulo."""
    if not iso_str: return ""
    try:
        s = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_BR_TZ).strftime("%H:%M")
    except Exception:
        return ""

# Detecta gramatura no final do nome: "PARMESÃO 30G", "ABACAXI 100G", "ALCATRA 130G", etc
_PORCAO_RE = re.compile(r'\s+(\d+(?:[.,]\d+)?)\s*[Gg]\s*$')

def _extrair_porcao(nome):
    """Retorna (nome_sem_porcao, 'NNG'|None)."""
    m = _PORCAO_RE.search(nome)
    if not m:
        return nome.strip(), None
    qtd = m.group(1).replace(",", ".")
    if qtd.endswith(".0"): qtd = qtd[:-2]
    return _PORCAO_RE.sub("", nome).strip(), f"{qtd}G"

def _prod_fit(draw, texto, max_w, max_h, bold=True, tam_max=72, tam_min=10):
    loader = _prod_fonte_bold if bold else _prod_fonte_normal
    for s in range(tam_max, tam_min - 1, -1):
        f = loader(s)
        bb = draw.textbbox((0, 0), texto, font=f)
        if (bb[2] - bb[0]) <= max_w and (bb[3] - bb[1]) <= max_h: return f
    return loader(tam_min)

def _prod_wrap(draw, texto, font, max_w):
    palavras, linhas, atual = texto.split(), [], ""
    for p in palavras:
        t = (atual + " " + p).strip()
        bb = draw.textbbox((0, 0), t, font=font)
        if (bb[2] - bb[0]) <= max_w: atual = t
        else:
            if atual: linhas.append(atual)
            atual = p
    if atual: linhas.append(atual)
    return linhas

def gerar_etiqueta_producao(payload, larg=None, alt=None):
    """
    Layout CO LOVE v159 — etiqueta 50x25mm, FUNDO BRANCO + texto PRETO bold (nitido na termica).
    UMA informação por linha, TODAS no MESMO tamanho de fonte, distribuídas
    igualmente na altura (cada linha ocupa uma fatia igual da etiqueta):
        NOME / FAB: dd/mm/aaaa / VAL: dd/mm/aaaa / POR: NNG / RES: NOME
    Preto/branco puro pra nitidez na térmica.
    """
    larg = larg if larg else CO_LOVE_LARGURA_PX
    alt = alt if alt else CO_LOVE_ALTURA_PX
    img = Image.new("RGB", (larg, alt), "white")   # FUNDO BRANCO (traco preto fino = nitido na termica)
    draw = ImageDraw.Draw(img)
    # margem direita maior pra a lateral direita nao ser cortada na impressao
    margem_e, margem_d, margem_t, margem_b = 16, 34, 6, 6
    largura_util = larg - margem_e - margem_d
    altura_util = alt - margem_t - margem_b

    nome_raw = (payload.get("product_name") or "?").upper()
    nome, porcao = _extrair_porcao(nome_raw)
    fab = _prod_data_br(payload.get("manufacture_date") or "")
    val = _prod_data_br(payload.get("expiry_date") or "")
    resp = (payload.get("responsible_name") or "?").strip().upper()

    linhas = [nome, f"FAB: {fab}", f"VAL: {val}"]
    if porcao: linhas.append(f"POR: {porcao}")
    linhas.append(f"RES: {resp}")
    n = len(linhas)

    def w(t, f): bb = draw.textbbox((0, 0), t, font=f); return bb[2] - bb[0]
    def hgt(t, f): bb = draw.textbbox((0, 0), t, font=f); return bb[3] - bb[1]

    # Maior fonte BOLD onde TODAS as linhas cabem na largura E na fatia de altura
    slot = altura_util / n
    tam = 9
    for s in range(80, 8, -1):
        f = _prod_fonte_bold(s)
        if all(w(l, f) <= largura_util for l in linhas) and max(hgt(l, f) for l in linhas) <= slot - 3:
            tam = s; break
    f = _prod_fonte_bold(tam)

    # Desenha cada linha centralizada na fatia, no centro da AREA UTIL (nao da imagem),
    # pra o texto ficar levemente a esquerda e nao encostar na borda direita cortada.
    cx = margem_e + largura_util // 2
    for i, l in enumerate(linhas):
        cy = margem_t + int(i * slot + slot / 2)
        draw.text((cx, cy), l, fill="black", font=f, anchor="mm")

    # Térmica: preto puro / branco puro (sem cinza do anti-aliasing)
    img = img.convert("L").point(lambda p: 0 if p < 190 else 255).convert("RGB")
    return img

def _devmode_papel(printer_name, larg_mm, alt_mm):
    """DEVMODE da impressora com o tamanho de papel FORCADO em larg_mm x alt_mm.
    Devolve None se nao der (ex.: sem pywin32). Tamanhos em decimos de milimetro."""
    try:
        import win32print, win32con
        h = win32print.OpenPrinter(printer_name)
        try:
            dm = win32print.GetPrinter(h, 2).get("pDevMode")
            if dm is None:
                return None
            dm.PaperSize = 256                       # DMPAPER_USER (tamanho personalizado)
            dm.PaperWidth = int(round(larg_mm * 10)) # decimos de mm
            dm.PaperLength = int(round(alt_mm * 10))
            dm.Orientation = 1                       # DMORIENT_PORTRAIT
            dm.Fields = (dm.Fields | win32con.DM_PAPERSIZE | win32con.DM_PAPERWIDTH
                         | win32con.DM_PAPERLENGTH | win32con.DM_ORIENTATION)
            return dm
        finally:
            win32print.ClosePrinter(h)
    except Exception as e:
        log(f"  devmode papel falhou: {e}")
        return None

def imprimir_etiqueta_producao(img, printer_name, copias=1):
    """Imprime a etiqueta de validade do CO LOVE FORCANDO o papel pra 50x25mm e
    preenchendo a area real de impressao (HORZRES/VERTRES). Resolve o caso de a
    etiqueta 'espalhar em 2' quando o driver tem um tamanho de papel antigo/errado.
    Se pywin32 faltar, cai no metodo antigo (_imprimir_dib)."""
    with _print_lock:
        try:
            import win32ui, win32gui, win32con
            from PIL import ImageWin
        except ImportError:
            log("  pywin32 ausente; usando metodo antigo (sem forcar 50x25)")
            for _ in range(copias):
                _imprimir_dib(img, printer_name, CO_LOVE_LARGURA_PX, CO_LOVE_ALTURA_PX)
                time.sleep(0.2)
            return
        try:
            hdc = win32ui.CreateDC(); hdc.CreatePrinterDC(printer_name)
        except Exception as e:
            log(f"  ERRO criar DC producao: {e}"); return
        try:
            dm = _devmode_papel(printer_name, CO_LOVE_LARGURA_MM, CO_LOVE_ALTURA_MM)
            if dm is not None:
                try: win32gui.ResetDC(hdc.GetSafeHdc(), dm)
                except Exception as e: log(f"  ResetDC ignorado: {e}")
            try:
                aw = hdc.GetDeviceCaps(win32con.HORZRES); ah = hdc.GetDeviceCaps(win32con.VERTRES)
            except Exception:
                aw, ah = 0, 0
            # A etiqueta e' SEMPRE deitada (50mm larg x 25mm alt = 399x199px). Nao giramos:
            # o sintoma e' "espalha em 2", nao texto torto. Se a area reportada estiver zerada
            # ou "em pe"/muito fora do esperado, o driver IGNOROU o tamanho forcado -> avisa
            # bem alto no log (precisa calibrar a impressora) e desenha no tamanho correto.
            esperado_w, esperado_h = CO_LOVE_LARGURA_PX, CO_LOVE_ALTURA_PX
            area_ok = (aw > 0 and ah > 0 and aw >= ah
                       and abs(aw - esperado_w) <= esperado_w * 0.30
                       and abs(ah - esperado_h) <= esperado_h * 0.30)
            if not area_ok:
                log(f"  AVISO: driver NAO aplicou 50x25 (area {aw}x{ah}px, esperado ~{esperado_w}x{esperado_h}). "
                    f"Calibrar a impressora de PRODUCAO (192.168.1.24): tamanho 50x25mm + calibrar gap/midia.")
                aw, ah = esperado_w, esperado_h
            dib = ImageWin.Dib(img)
            for _ in range(copias):
                hdc.StartDoc("Etiqueta CO Love"); hdc.StartPage()
                dib.draw(hdc.GetHandleOutput(), (0, 0, aw, ah))
                hdc.EndPage(); hdc.EndDoc()
                time.sleep(0.2)
            log(f"  Impresso OK producao x{copias} ({printer_name}) area {aw}x{ah}px")
        except Exception as e:
            log(f"  ERRO impressao producao: {e}")
        finally:
            try: hdc.DeleteDC()
            except: pass

def _imprimir_dib(img, printer_name, larg, alt):
    """Print cru de uma imagem num DC de impressora (sem _print_lock; ja deve estar travado)."""
    try:
        import win32ui; from PIL import ImageWin
        hdc = win32ui.CreateDC(); hdc.CreatePrinterDC(printer_name)
        hdc.StartDoc("Etiqueta CO Love"); hdc.StartPage()
        ImageWin.Dib(img).draw(hdc.GetHandleOutput(), (0, 0, larg, alt))
        hdc.EndPage(); hdc.EndDoc(); hdc.DeleteDC()
        log(f"  Impresso OK ({printer_name})")
    except ImportError:
        tmp = tempfile.NamedTemporaryFile(suffix=".bmp", delete=False); tp = tmp.name; tmp.close()
        try:
            img.save(tp, "BMP")
            subprocess.run(f'mspaint /pt "{tp}" "{printer_name}"', shell=True, capture_output=True, timeout=10)
            log("  Impresso OK (mspaint)")
        finally:
            try: time.sleep(2); os.unlink(tp)
            except: pass
    except Exception as e:
        log(f"  ERRO: {e}")

def processar_lovelabel(filepath, filename):
    try:
        time.sleep(0.6)
        with open(filepath, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        log(f"  ERRO lendo .lovelabel: {e}"); return
    if payload.get("type") != "producao":
        log(f"  .lovelabel ignorado (type != producao)"); return
    batch_id = payload.get("batch_id", "?")
    is_reprint = bool(payload.get("reprint"))
    now = time.time()
    last = _LOVELABEL_SEEN.get(batch_id)
    if last and (now - last) < _LOVELABEL_DEDUP_S and not is_reprint:
        log(f"  dedup .lovelabel {str(batch_id)[:8]}")
        try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename))
        except: pass
        return
    _LOVELABEL_SEEN[batch_id] = now
    qtd = max(1, min(50, int(payload.get("quantity", 1))))
    nome = payload.get("product_name", "?")
    log(f"  CO LOVE: {qtd}x '{nome}' (batch {str(batch_id)[:8]}{'/REIMP' if is_reprint else ''})")
    impressora = _impressora_para(IP_IMPRESSORA_PRODUCAO, fallback=NOME_IMPRESSORA, etiqueta="PRODUCAO")
    img = gerar_etiqueta_producao(payload)
    try: imprimir_etiqueta_producao(img, impressora, copias=qtd)
    except Exception as e: log(f"  ERRO imp producao: {e}")
    try: os.makedirs(PASTA_SAIPOS, exist_ok=True); shutil.move(filepath, os.path.join(PASTA_SAIPOS, filename)); log(f"  Movido")
    except Exception as e: log(f"  ERRO mover: {e}")


class SaiposHandler(FileSystemEventHandler):
    def on_created(self, event): self._processar(event.src_path)
    def on_moved(self, event): self._processar(event.dest_path)
    def _processar(self, filepath):
        if os.path.isdir(filepath): return
        fn = os.path.basename(filepath).lower()
        if fn.endswith(".saiposprt") or fn.endswith(".saiposnfeprt"):
            time.sleep(1)
            try: processar_arquivo(filepath)
            except Exception as e: log(f"ERRO: {fn}: {e}")
        elif fn.endswith(".lovelabel"):
            try: processar_lovelabel(filepath, os.path.basename(filepath))
            except Exception as e: log(f"ERRO lovelabel: {fn}: {e}")
        elif fn.endswith(".sofiapedido"):
            try: processar_sofia_arquivo(filepath, os.path.basename(filepath))
            except Exception as e: log(f"ERRO sofiapedido: {fn}: {e}")

# ============================================================
# SOFIA - Pedidos por telefone (comanda + etiquetas via fila online)
# ============================================================
SOFIA_SUPABASE_URL = "https://enlzjbrxzopplmysdhgl.supabase.co"
SOFIA_SUPABASE_HOSTS_ANTIGOS = {
    "hvpmkkxvvjnefayrlcjy.supabase.co",
    "vcauihrxugykkvjoyecs.supabase.co",
}
SOFIA_POLL_INTERVAL = 5            # segundos entre consultas
SOFIA_UPDATE_EVERY = 1800          # checa atualizacao do helper a cada 30min no caixa
SOFIA_CONFIG = os.path.join(PASTA_DOWNLOADS, "sofia_caixa.json")
_sofia_impressos = {}              # id -> timestamp (dedup local)

def _sofia_url_atual(url):
    """Troca apenas hosts antigos conhecidos; mantém caminhos e configurações desconhecidas intactos."""
    atual = (url or SOFIA_SUPABASE_URL).rstrip("/")
    try:
        if urllib.parse.urlsplit(atual).hostname in SOFIA_SUPABASE_HOSTS_ANTIGOS:
            return SOFIA_SUPABASE_URL
    except Exception:
        pass
    return atual

def _sofia_config():
    """Le {url?, secret?} de ~/Downloads/sofia_caixa.json. Sem arquivo -> poller idle."""
    if not os.path.exists(SOFIA_CONFIG):
        return None
    try:
        with open(SOFIA_CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        url = _sofia_url_atual(cfg.get("url"))
        return {"url": url, "secret": cfg.get("secret") or ""}
    except Exception as e:
        log(f"  SOFIA config invalida: {e}")
        return None

def _sofia_ctx():
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    return ctx

def _sofia_http(url, method="GET", body=None, secret="", pc=""):
    headers = {"Content-Type": "application/json"}
    if secret: headers["x-sofia-secret"] = secret
    if pc: headers["x-etiqueta-pc"] = pc
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    resp = urllib.request.urlopen(req, timeout=15, context=_sofia_ctx())
    return json.loads(resp.read().decode("utf-8"))

def sofia_pag_cat(forma, troco_para, total, pagamentos=None, bandeira=""):
    """Mapeia forma_pagamento da Sofia pro vocabulario do rodape (PAGO/MAQUINONA/DINHEIRO...)."""
    f = (forma or "").lower()
    parcelas = pagamentos if isinstance(pagamentos, list) else []
    pendentes = [p for p in parcelas if not p.get("online")]
    # O Provisao envia parcelas inclusive para dinheiro. Nao deixar o resumo
    # generico esconder o troco que o render Saipos ja sabe exibir.
    so_dinheiro = bool(pendentes) and all(str(p.get("forma") or f).lower() == "dinheiro" for p in pendentes)
    if f != "pago" and (so_dinheiro or (not parcelas and f == "dinheiro")):
        valor_dinheiro = sum(float(p.get("valor") or 0) for p in pendentes) if pendentes else float(total)
        try:
            if troco_para and float(troco_para) > valor_dinheiro:
                return "DINHEIRO_TROCO", {"valor_pedido": valor_dinheiro, "valor_receber": float(troco_para), "valor_troco": round(float(troco_para)-valor_dinheiro, 2)}
        except (TypeError, ValueError):
            pass
        return "DINHEIRO", {"valor": valor_dinheiro}
    if parcelas or f in ("vale", "voucher", "credito", "crédito", "debito", "débito", "pix"):
        nomes = {
            "vale": "VALE", "voucher": "VALE",
            "credito": "CREDITO", "crédito": "CREDITO",
            "debito": "DEBITO", "débito": "DEBITO",
            "pix": "PIX", "dinheiro": "DINHEIRO", "pago": "PAGO",
        }
        usar = [p for p in parcelas if not p.get("online")]
        if not usar: usar = parcelas
        if not usar: usar = [{"forma": f, "valor": total, "online": False}]
        detalhes = []
        for p in usar:
            pf = str(p.get("forma") or f or "pagamento").lower()
            nome = nomes.get(pf, pf.upper())
            if bandeira and pf in ("vale", "voucher", "credito", "crédito", "debito", "débito"):
                nome = f"{nome} {str(bandeira).upper()}"
            try: valor = float(p.get("valor") if p.get("valor") is not None else total)
            except: valor = float(total or 0)
            detalhes.append(f"{nome}: R${formatar_valor(valor)}")
        dinheiro_pendente = sum(float(p.get("valor") or 0) for p in pendentes if str(p.get("forma") or f).lower() == "dinheiro")
        try:
            if f != "pago" and dinheiro_pendente > 0 and troco_para and float(troco_para) > dinheiro_pendente:
                detalhes.append(f"TROCO PARA: R${formatar_valor(float(troco_para))}")
        except (TypeError, ValueError):
            pass
        todos_online = bool(parcelas) and all(bool(p.get("online")) for p in parcelas)
        return ("PAGO_DETALHE" if todos_online or f == "pago" else "COBRAR_DETALHE"), {"resumo": " + ".join(detalhes)}
    if f == "pago": return "PAGO", {}
    if f in ("maquininha","maquinona","cartao","credito","debito","pix"): return "MAQUINONA", {"valor": total}
    if f == "dinheiro":
        try:
            if troco_para and float(troco_para) > float(total):
                return "DINHEIRO_TROCO", {"valor_pedido": total, "valor_receber": float(troco_para), "valor_troco": float(troco_para)-float(total)}
        except: pass
        return "DINHEIRO", {"valor": total}
    return "", {}

_ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')

def sofia_quando(hora):
    """v201: o Provisao manda a hora em ISO/UTC. Devolve (datetime em Brasilia, "HH:MM").
    Texto que nao e ISO (ex.: "18:09") passa como esta."""
    h = str(hora or "").strip()
    if not _ISO_RE.match(h):
        return None, h
    try:
        dt = datetime.fromisoformat(h.replace("Z", "+00:00"))
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(_BR_TZ)
        return dt, dt.strftime("%H:%M")
    except Exception:
        return None, h

def sofia_eh_obs(it):
    return (str(it.get("tipo") or "").lower() in ("outro", "obs")) and re.match(r'^\s*obs\s*:', str(it.get("nome") or ""), re.I) is not None

def _sofia_qrs(it):
    """v204: codigos do QR (1 por unidade) que o Provisao manda em itens[].qr. So aceita o formato certo."""
    out = []
    for c in (it.get("qr") or []):
        c = str(c or "").strip().upper()
        out.append(c if re.fullmatch(r"EQ[0-9A-Z]{10}", c) else None)
    return out

def sofia_etiquetas_unitarias(display):
    """v204: uma etiqueta por PRODUTO (cada pizza salgada/doce e cada Pote Dip, unidade por unidade).
    Bebida, observacao e "outro" do pedido vao em TODAS. Borda antiga fica com a pizza dela.
    Devolve [(display_da_etiqueta, codigo_qr_ou_None), ...] na ordem do pedido."""
    extras = [d for d in display if d["tipo"] in ("bebida", "obs", "outro")]
    unidades = []
    for d in display:
        if d["tipo"] in ("caixa_salgada", "caixa_doce", "dip"):
            qrs = d.get("qr") or []
            for k in range(max(1, int(d.get("qty") or 1))):
                unidades.append({"item": dict(d, qty=1), "bordas": [], "qr": qrs[k] if k < len(qrs) else None})
        elif d["tipo"] == "borda" and unidades:
            unidades[-1]["bordas"].append(d)
    return [([u["item"]] + u["bordas"] + extras, u["qr"]) for u in unidades]

def sofia_display(itens):
    """Converte itens estruturados (DB) -> display_items do gerar_etiqueta (mesmo render Saipos)."""
    display = []
    for it in (itens or []):
        tipo = (it.get("tipo") or "").lower()
        try: qtd = max(1, int(it.get("qtd") or 1))
        except: qtd = 1
        nome = limpar_nome(it.get("nome") or "Item")
        if tipo == "pizza":
            cat = "caixa_doce" if (it.get("categoria") == "doce") else "caixa_salgada"
            sabores = []
            for s in (it.get("sabores") or []):
                snome = (s.get("nome") or "").strip()
                if not snome: continue
                fr = (s.get("fracao") or "").strip().replace(" ", "")
                if fr and fr != "1/1" and "inteir" not in fr.lower():
                    sabores.append(f"{fr} {snome}")
                else:
                    sabores.append(snome)
            display.append({"tipo": cat, "nome": nome, "qty": qtd, "sabores": sabores, "qr": _sofia_qrs(it)})
            if it.get("borda"):
                display.append({"tipo": "borda", "nome": str(it["borda"]), "qty": 1, "sabores": []})
        elif tipo == "bebida":
            display.append({"tipo": "bebida", "nome": nome, "qty": qtd, "sabores": []})
        elif tipo == "dip":
            display.append({"tipo": "dip", "nome": nome, "qty": qtd, "sabores": [], "qr": _sofia_qrs(it)})
        elif sofia_eh_obs(it):
            # v201: observacao nao e item (nao conta em ITENS) e repetida sai uma vez so
            txt = re.sub(r'\s+', ' ', str(it.get("nome") or "")).strip()
            if not any(d["tipo"] == "obs" and d["nome"].lower() == txt.lower() for d in display):
                display.append({"tipo": "obs", "nome": txt, "qty": 1, "sabores": []})
        else:
            display.append({"tipo": "outro", "nome": nome, "qty": qtd, "sabores": []})
    return display

def sofia_totais(display):
    """Mesma contagem operacional usada no Saipos: dip conta como item e etiqueta;
    bebida conta como item, mas não gera etiqueta."""
    total_caixas = sum(d["qty"] for d in display if d["tipo"] in ("caixa_salgada", "caixa_doce"))
    total_dips = sum(d["qty"] for d in display if d["tipo"] == "dip")
    total_bebidas = sum(d["qty"] for d in display if d["tipo"] == "bebida")
    total_outros = sum(d["qty"] for d in display if d["tipo"] == "outro")
    total_entrega = total_caixas + total_dips + total_bebidas + total_outros
    total_etiquetas = total_caixas + total_dips
    return total_caixas, total_dips, total_bebidas, total_outros, total_entrega, total_etiquetas

def gerar_comanda(pedido):
    """Comanda de despacho 80x30mm: Nº/SOFIA/hora, cliente, endereco, pagamento, total."""
    img = Image.new("RGB", (LARGURA_PX, ALTURA_PX), "white")
    draw = ImageDraw.Draw(img)
    me = 14; md = 14
    def cf(t):
        try: return ImageFont.truetype("arialbd.ttf", t)
        except:
            try: return ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", t)
            except: return ImageFont.load_default()
    def tw(txt, f):
        try: bb = draw.textbbox((0,0), txt, font=f); return bb[2]-bb[0]
        except: return len(txt)*8
    maxw = LARGURA_PX - me - md

    try: num = f"{int(pedido.get('numero') or 0):04d}"
    except: num = str(pedido.get("numero") or "")
    hora = pedido.get("hora") or ""
    tipo = (pedido.get("tipo") or "entrega").lower()
    canal = str(pedido.get("canal") or "Sofia").strip() or "Sofia"
    header = f"#{num} {canal.upper()}" + (f" {hora}" if hora else "")

    def fit1(txt, teto, piso):
        for sz in range(teto, piso-1, -1):
            if tw(txt, cf(sz)) <= maxw: return sz
        return piso
    fsh = fit1(header, 34, 12); fh = cf(fsh)
    try: bbh = draw.textbbox((0,0),"Ag",font=fh); hh = (bbh[3]-bbh[1])+10
    except: hh = fsh+10

    total = float(pedido.get("total") or 0)
    troco = pedido.get("troco_para")
    forma = (pedido.get("forma_pagamento") or "")
    cliente = (pedido.get("nome_cliente") or "Sem nome").strip()
    fone = (pedido.get("telefone") or "").strip()
    linhas = []
    titulo_tipo = "SALAO" if tipo == "salao" else ("RETIRADA NO BALCAO" if tipo == "retirada" else "ENTREGA")
    linhas.append((titulo_tipo, True))
    linhas.append((cliente + (f"  {fone}" if fone else ""), True))
    if tipo == "entrega":
        end = ", ".join([x for x in [pedido.get("endereco"), pedido.get("complemento")] if x])
        if end: linhas.append((end, False))
        b = pedido.get("bairro") or ""; ref = pedido.get("referencia") or ""
        if b or ref: linhas.append(((b + (f" - ref: {ref}" if ref else "")).strip(), False))
    fl = forma.lower()
    if fl == "pago": pag_txt = "PAGO (online)"
    elif fl == "pix": pag_txt = "PIX"
    elif fl in ("maquininha","maquinona","cartao","credito","debito"): pag_txt = "MAQUININHA na entrega"
    elif fl == "dinheiro":
        if troco and float(troco) > total:
            pag_txt = f"DINHEIRO - troco p/ R${formatar_valor(float(troco))} (devolver R${formatar_valor(float(troco)-total)})"
        else: pag_txt = "DINHEIRO"
    else: pag_txt = "CONFIRMAR PAGAMENTO"
    linhas.append((pag_txt, False))
    obs = (pedido.get("observacoes") or "").strip()
    if obs: linhas.append((f"OBS: {obs}", False))

    n_itens = 0
    for it in (pedido.get("itens") or []):
        if sofia_eh_obs(it): continue  # v201: observacao nao e item
        try: n_itens += max(1, int(it.get("qty") or it.get("qtd") or 1))
        except: n_itens += 1
    rodape = f"TOTAL R${formatar_valor(total)}  -  {n_itens} item(s)"
    fsr = fit1(rodape, fsh, 12); fr = cf(fsr)
    try: bbr = draw.textbbox((0,0),"Ag",font=fr); hr = (bbr[3]-bbr[1])+10
    except: hr = fsr+10

    y0 = hh + 4
    alt_corpo = ALTURA_PX - hr - y0 - 4
    chosen = None
    for sz in range(22, 9, -1):
        f = cf(sz)
        try: bb = draw.textbbox((0,0),"Ag",font=f); lh = (bb[3]-bb[1])+5
        except: lh = sz+5
        wrapped = []
        for txt, bold in linhas:
            for wl in word_wrap(txt, draw, f, maxw): wrapped.append((wl, bold))
        if len(wrapped)*lh <= alt_corpo:
            chosen = (sz, lh, wrapped); break
    if not chosen:
        sz = 10; f = cf(sz)
        try: bb = draw.textbbox((0,0),"Ag",font=f); lh = (bb[3]-bb[1])+4
        except: lh = sz+4
        wrapped = []
        for txt, bold in linhas:
            for wl in word_wrap(txt, draw, f, maxw): wrapped.append((wl, bold))
        chosen = (sz, lh, wrapped[: max(1, alt_corpo // max(1, lh))])
    sz, lh, wrapped = chosen

    draw.rectangle([(0,0),(LARGURA_PX,hh)], fill="black")
    try: bb = draw.textbbox((0,0),header,font=fh); yh = (hh-(bb[3]-bb[1]))//2 - 2
    except: yh = 2
    draw.text((me, yh), header, fill="white", font=fh)
    y = y0
    for wl, bold in wrapped:
        draw.text((me, y), wl, fill="black", font=cf(sz)); y += lh
    draw.rectangle([(0, ALTURA_PX-hr),(LARGURA_PX, ALTURA_PX)], fill="black")
    try: bb = draw.textbbox((0,0),rodape,font=fr); yr = (ALTURA_PX-hr)+(hr-(bb[3]-bb[1]))//2 - 2
    except: yr = ALTURA_PX-hr+2
    draw.text((me, yr), rodape, fill="white", font=fr)
    return img

COMANDA_CUPOM_W = 576   # 80mm util (~72mm) @ 203 DPI -> Elgin i8

_MESES_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]

def gerar_comanda_cupom(pedido):
    """Comanda em CUPOM (80mm, Elgin i8) no formato do Saipos: ENTREGA/RETIRADA, data,
    Nº do pedido, cliente, endereco (entrega), lista de itens com sabores, qtd de itens,
    pagamento/troco e rodape. Imagem de largura fixa e altura variavel."""
    W = COMANDA_CUPOM_W
    ML, MR = 14, 14
    USE = W - ML - MR
    img = Image.new("RGB", (W, 2600), "white")
    draw = ImageDraw.Draw(img)
    fb = _prod_fonte_bold
    fn = _prod_fonte_normal

    def alt(f):
        try: bb = draw.textbbox((0,0), "Ag", font=f); return (bb[3]-bb[1])
        except: return 20
    def larg(s, f):
        try: bb = draw.textbbox((0,0), s, font=f); return (bb[2]-bb[0])
        except: return len(s)*10

    y = 12
    def center(s, f, fill="black", gap=6):
        nonlocal y
        x = (W - larg(s, f)) // 2
        draw.text((x, y), s, font=f, fill=fill)
        y += alt(f) + gap
    def left(s, f, x=ML, gap=5):
        nonlocal y
        for ln in word_wrap(s, draw, f, W - x - MR):
            draw.text((x, y), ln, font=f, fill="black")
            y += alt(f) + gap
    def lr(le, ri, f, gap=6):
        nonlocal y
        draw.text((ML, y), le, font=f, fill="black")
        draw.text((W - MR - larg(ri, f), y), ri, font=f, fill="black")
        y += alt(f) + gap
    def dash(gap=10):
        nonlocal y
        y += 2
        x = ML
        while x < W - MR:
            draw.line([(x, y), (min(x+8, W-MR), y)], fill="black", width=2)
            x += 14
        y += gap
    def bar(s, f, gap=8):
        nonlocal y
        h = alt(f) + 14
        draw.rectangle([(0, y), (W, y + h)], fill="black")
        x = (W - larg(s, f)) // 2
        draw.text((x, y + 7), s, font=f, fill="white")
        y += h + gap

    tipo = (pedido.get("tipo") or "entrega").lower()
    canal = str(pedido.get("canal") or "Sofia").strip() or "Sofia"
    try: num = f"{int(pedido.get('numero') or 0):04d}"
    except: num = str(pedido.get("numero") or "")
    hora = (pedido.get("hora") or "").strip()
    try:
        ag = pedido.get("_quando") or datetime.now(_BR_TZ); data_str = f"{ag.day:02d}/{_MESES_PT[ag.month-1]}"
    except: data_str = ""
    if hora: data_str = f"{data_str} - {hora}" if data_str else hora

    # Cabecalho
    titulo_tipo = "SALAO" if tipo == "salao" else ("RETIRADA NO BALCAO" if tipo == "retirada" else "ENTREGA")
    center(titulo_tipo, fb(40), gap=8)
    dash()
    if data_str: center(data_str, fn(28)); dash()
    bar(f"PEDIDO Nº {num}  -  {canal.upper()}", fb(32))
    dash()

    # Cliente
    cli = (pedido.get("nome_cliente") or "Sem nome").strip()
    center(cli, fb(36), gap=4)
    fone = (pedido.get("telefone") or "").strip()
    if fone: center(fone, fn(26))
    dash()

    # Endereco (so entrega)
    if tipo == "entrega":
        end = (pedido.get("endereco") or "").strip()
        compl = (pedido.get("complemento") or "").strip()
        bairro = (pedido.get("bairro") or "").strip()
        ref = (pedido.get("referencia") or "").strip()
        if end: left(end + (f" - {compl}" if compl else ""), fb(28))
        if bairro: left(f"Bairro: {bairro}", fn(26))
        if ref: left(f"Ref: {ref}", fn(26))
        if end or bairro or ref: dash()

    # Itens
    left("Qt.Descrição", fn(24), gap=8)
    itens = pedido.get("itens") or []
    n_itens = 0
    obs_vistas = set()
    for it in itens:
        if sofia_eh_obs(it):  # v201: observacao nao conta como item e repetida sai uma vez
            txt = re.sub(r'\s+', ' ', str(it.get("nome") or "")).strip()
            if txt.lower() not in obs_vistas:
                obs_vistas.add(txt.lower()); left(txt, fb(26), x=ML+24, gap=3); y += 6
            continue
        try: q = max(1, int(it.get("qtd") or 1))
        except: q = 1
        n_itens += q
        nome = (it.get("nome") or "Item").strip()
        left(f"{q}  {nome}", fb(30), gap=3)
        if (it.get("tipo") or "") == "pizza":
            for s in (it.get("sabores") or []):
                sn = (s.get("nome") or "").strip()
                if not sn: continue
                fr = (s.get("fracao") or "").strip().replace(" ", "")
                pref = f"-{fr} " if (fr and fr != "1/1" and "inteir" not in fr.lower()) else "-"
                left(f"{pref}{sn}", fn(28), x=ML+24, gap=3)
            if it.get("borda"):
                left(f"Borda: {it['borda']}", fn(28), x=ML+24, gap=3)
        obs_i = (it.get("obs") or "").strip()
        if obs_i: left(f"* {obs_i}", fn(26), x=ML+24, gap=3)
        y += 6
    dash()
    lr("Quantidade de itens:", str(n_itens), fb(28))
    dash()

    # Pagamento (Sofia: entrega propria precisa pro entregador)
    forma = (pedido.get("forma_pagamento") or "").lower()
    total = float(pedido.get("total") or 0)
    troco = pedido.get("troco_para")
    if forma == "pago": pag = "PAGO (online)"
    elif forma == "pix": pag = "PIX"
    elif forma in ("maquininha","maquinona","cartao","credito","debito"): pag = "MAQUININHA na entrega"
    elif forma == "dinheiro":
        if troco and float(troco) > total:
            pag = f"DINHEIRO - Troco para R${formatar_valor(float(troco))}"
        else: pag = "DINHEIRO"
    else: pag = "CONFIRMAR PAGAMENTO"
    bar(f"TOTAL  R${formatar_valor(total)}", fb(34))
    center(pag, fn(28), gap=4)
    if forma == "dinheiro" and troco and float(troco) > total:
        center(f"(devolver R${formatar_valor(float(troco)-total)})", fn(24))
    obs = (pedido.get("observacoes") or "").strip()
    if obs:
        dash(); left(f"OBS: {obs}", fb(26))
    dash()

    # Rodape (estilo Saipos)
    center(f"Canal: {canal}", fn(24), gap=4)
    if data_str: center(f"Data/hora: {data_str}", fn(24))
    bar(f"Nº Pedido: {num}", fb(28))
    center("Pizzaria Estrela da Ilha", fn(22), gap=2)

    # Recorta na altura usada + folga pro corte
    final = img.crop((0, 0, W, min(y + 48, 2600)))
    return final

def processar_sofia_pedido(pedido, impressora):
    numero = str(pedido.get("numero") or "")
    canal = str(pedido.get("canal") or "Sofia").strip() or "Sofia"
    codigo_canal = str(pedido.get("codigo_canal") or canal).strip() or canal
    display = sofia_display(pedido.get("itens"))
    total_caixas, total_dips, total_bebidas, total_outros, total_entrega, n_et = sofia_totais(display)
    total_valor = float(pedido.get("total") or 0)
    pag_cat, pag_dados = sofia_pag_cat(
        pedido.get("forma_pagamento"), pedido.get("troco_para"), total_valor,
        pedido.get("pagamentos"), pedido.get("bandeira_pagamento")
    )
    balcao = (pedido.get("tipo") == "retirada")
    nome_cli = (pedido.get("nome_cliente") or "").strip().split(" ")[0].upper() if pedido.get("nome_cliente") else ""
    quando, hora = sofia_quando(pedido.get("hora"))
    # cupom e comanda de despacho recebem a hora ja em HH:MM e a data do pedido (v201)
    pedido = dict(pedido, hora=hora, _quando=quando)

    # 1) ETIQUETAS das caixas de pizza -> impressora de etiqueta (.14)
    # Mesmo padrão do Saipos: cada pizza e cada Pote Dip recebem etiqueta;
    # bebida entra em ITENS, sem criar etiqueta própria.
    falhou = False
    # v204: uma etiqueta por produto (o meio mostra so ele; bebida/obs em todas) + QR do produto
    unidades = sofia_etiquetas_unitarias(display)
    n_et = len(unidades)
    for i, (display_i, qr_i) in enumerate(unidades, start=1):
        try:
            img = gerar_etiqueta(numero, i, n_et, display_i, total_entrega,
                                 pag_cat, pag_dados, balcao, canal.upper(), codigo_canal.upper(), nome_cli, hora,
                                 qr_texto=qr_i, unitario=True)
            if imprimir_etiqueta(img, printer_name=impressora):
                log(f"  {canal.upper()} #{numero}: etiqueta {i}/{n_et}")
                sofia_evento("etiqueta_ok", pedido, etiqueta=i, total=n_et, impressora=impressora)
            else:
                falhou = True
                log(f"  ERRO etiqueta {i}/{n_et} #{numero}: impressora nao imprimiu")
                sofia_evento("etiqueta_erro", pedido, etiqueta=i, total=n_et, impressora=impressora,
                             detalhe="impressora nao imprimiu")
            if i < n_et: time.sleep(0.4)
        except Exception as e:
            falhou = True
            log(f"  ERRO etiqueta {i}/{n_et} #{numero}: {e}")
            sofia_evento("etiqueta_erro", pedido, etiqueta=i, total=n_et, impressora=impressora, detalhe=e)

    # 2) COMANDA em cupom estilo Saipos -> impressora de comanda (.222, Elgin i8)
    # v202: etiqueta falhou -> o pedido volta pra fila e OUTRO PC imprime tudo; o cupom fica pra ele
    # (senao sairia repetido).
    if falhou:
        log(f"  {canal.upper()} #{numero}: etiqueta falhou - pedido volta pra fila, cupom nao impresso aqui")
        return False
    imp_comanda = _impressora_para(IP_IMPRESSORA_COMANDA, fallback=None, etiqueta="COMANDA")
    if imp_comanda and not _ip_responde(IP_IMPRESSORA_COMANDA):
        # v210: i8 da cozinha fora da rede -> nao trava o pedido tentando 4x (~6 s por pedido)
        log(f"  {canal.upper()} #{numero}: comanda pulada - {IP_IMPRESSORA_COMANDA} fora da rede")
        sofia_evento("cupom_erro", pedido, impressora=imp_comanda, detalhe="fora da rede (9100)")
    elif imp_comanda:
        try:
            cmd = gerar_comanda_cupom(pedido)
            if imprimir_etiqueta(cmd, printer_name=imp_comanda, larg=cmd.width, alt=cmd.height):
                log(f"  {canal.upper()} #{numero}: comanda (cupom) OK")
                sofia_evento("cupom_ok", pedido, impressora=imp_comanda)
            else:
                log(f"  ERRO comanda #{numero}: impressora nao imprimiu")
                sofia_evento("cupom_erro", pedido, impressora=imp_comanda, detalhe="impressora nao imprimiu")
        except Exception as e:
            log(f"  ERRO comanda #{numero}: {e}")
            sofia_evento("cupom_erro", pedido, impressora=imp_comanda, detalhe=e)
    else:
        log(f"  {canal.upper()} #{numero}: impressora de comanda (192.168.1.222) nao encontrada - comanda nao impressa")
        sofia_evento("cupom_sem_impressora", pedido, detalhe=IP_IMPRESSORA_COMANDA)
    # So as etiquetas das caixas decidem: se o cupom falhar, reimprimir tudo duplicaria as etiquetas.
    return not falhou

def processar_sofia_arquivo(filepath, filename):
    """Pedido da Sofia baixado pelo Caixa Love (.sofiapedido) -> imprime comanda + etiquetas.
    Mesmo mecanismo das etiquetas do CO LOVE: o arquivo cai em Downloads e o watcher imprime.
    Sem segredo, sem polling — basta o Caixa Love aberto no PC da cozinha.

    Robustez: 'reivindica' o arquivo via rename atomico ANTES de ler. Assim, se houver
    mais de uma copia do programa rodando (ou eventos duplicados do watcher), so UMA
    processa — as outras saem em silencio. Tambem tolera o arquivo ainda estar sendo
    escrito pelo navegador (tenta de novo)."""
    claim = filepath + ".printing"
    claimed = False
    for tentativa in range(8):  # ate ~2.4s aguardando o arquivo materializar/liberar
        if not os.path.exists(filepath):
            if tentativa == 0:
                time.sleep(0.3); continue   # navegador ainda pode estar criando
            return                          # sumiu / outra copia ja pegou -> silencioso
        try:
            os.replace(filepath, claim)     # reivindicacao atomica
            claimed = True
            break
        except FileNotFoundError:
            return                          # outra copia reivindicou primeiro -> silencioso
        except (PermissionError, OSError):
            time.sleep(0.3)                 # ainda sendo escrito/bloqueado -> tenta de novo
    if not claimed:
        log("  SOFIA: arquivo ocupado, nao consegui ler"); return

    try:
        with open(claim, "r", encoding="utf-8") as f:
            pedido = json.load(f)
    except Exception as e:
        log(f"  ERRO lendo .sofiapedido: {e}")
        try: os.remove(claim)
        except Exception: pass
        return

    numero = pedido.get("numero", "?")
    log(f"  SOFIA arquivo: pedido #{numero}")
    impressora = _impressora_caixas()
    try:
        processar_sofia_pedido(pedido, impressora)
        log(f"  SOFIA #{numero}: comanda + etiquetas OK")
    except Exception as e:
        log(f"  ERRO imprimindo SOFIA #{numero}: {e}")
    try:
        os.makedirs(PASTA_SAIPOS, exist_ok=True)
        shutil.move(claim, os.path.join(PASTA_SAIPOS, filename))
    except Exception:
        try: os.remove(claim)
        except Exception: pass

SOFIA_PING_EVERY = 300            # v203: "estou vivo" deste PC a cada 5 min (tabela etiqueta_pcs)
_sofia_eventos = []                # v203: eventos esperando ir pra nuvem (etiqueta_impressao_log)
_sofia_eventos_lock = threading.Lock()

def sofia_evento(evento, pedido=None, **extra):
    """Registra um evento de impressao pra subir pra nuvem. Nunca atrapalha a impressao."""
    try:
        e = {"em": datetime.now(timezone.utc).isoformat(), "versao": VERSION, "evento": evento}
        if pedido:
            e["fila_id"] = pedido.get("id")
            e["numero"] = str(pedido.get("numero") or "")
            e["canal"] = str(pedido.get("canal") or "")
        for k, v in extra.items():
            if v is not None: e[k] = v if isinstance(v, (int, float)) else str(v)[:500]
        with _sofia_eventos_lock:
            _sofia_eventos.append(e)
            del _sofia_eventos[:-500]   # sem internet por muito tempo: guarda os 500 mais novos
    except Exception:
        pass

def _sofia_enviar_eventos(base, secret, pc):
    """Sobe os eventos pendentes. Se falhar, devolve pra fila local e tenta no proximo ciclo."""
    with _sofia_eventos_lock:
        lote = _sofia_eventos[:300]
        del _sofia_eventos[:len(lote)]
    if not lote: return
    try:
        resp = _sofia_http(base, method="POST", body={"action": "log", "eventos": lote}, secret=secret, pc=pc)
        if (resp or {}).get("ok"): return
    except Exception:
        pass
    with _sofia_eventos_lock:
        _sofia_eventos[:0] = lote
        del _sofia_eventos[:-500]

SOFIA_PAUSA_APOS_FALHA = 60       # v202: PC cuja impressora falhou sai da fila por 1 min (os outros assumem)
_sofia_avisos = {}                 # aviso -> ultimo log (nao repetir a mesma mensagem a cada 5s)

def _sofia_avisar(chave, msg, cada=1800):
    agora = time.time()
    if agora - _sofia_avisos.get(chave, 0) >= cada:
        _sofia_avisos[chave] = agora
        if msg: log(msg)
        return True
    return False

def _nome_deste_pc():
    """Identifica o PC na fila (claimed_by), pra auditoria saber quem imprimiu cada etiqueta."""
    try:
        import socket
        nome = socket.gethostname()
    except Exception:
        nome = ""
    usuario = os.path.basename(os.path.expanduser("~"))
    return (f"{nome}/{usuario}" if nome else usuario)[:80]

def _impressora_caixas_deste_pc():
    """So entra na fila quem ENXERGA a impressora das caixas: pelo IP (.14) ou pelo nome instalado.
    PC sem ela nao pode reservar etiqueta (reservaria e nao imprimiria)."""
    nome = _nome_por_ip(IP_IMPRESSORA_CAIXAS)
    if nome:
        return _impressora_caixas(fallback=nome)
    # v206: sem a .14 neste PC, a impressora de producao (.24) tambem serve pras caixas
    if CAIXAS_NA_PRODUCAO != "nunca" and (_nome_por_ip(IP_IMPRESSORA_PRODUCAO) or _instalar_impressora_24()):
        return _impressora_caixas(fallback=None)
    try:
        import win32print
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        for p in win32print.EnumPrinters(flags, None, 2):
            if (p.get("pPrinterName") or "").strip().upper() == NOME_IMPRESSORA.upper():
                return p.get("pPrinterName")
    except Exception:
        pass
    return None

def sofia_poll_loop():
    """v202: TODO PC com a chave (sofia_caixa.json) e com a impressora das caixas e servidor de etiqueta.
    Nao duplica: a nuvem entrega cada etiqueta a UM PC so (reserva atomica). Se este PC nao conseguir
    imprimir, devolve a etiqueta pra fila na hora e sai da fila por 1 min -> outro PC imprime.
    Se o PC morrer no meio, a reserva vence em 2 min e outro PC pega sozinho."""
    log("SOFIA poller iniciado (fila de etiquetas do Provisao - todo PC com a chave participa)")
    last_update = time.time()
    pc = _nome_deste_pc()
    pausa_ate = 0
    impressora = None
    checou_impressora = 0
    ultimo_ping = 0
    sofia_evento("iniciou", detalhe=f"python {sys.version.split()[0]}")
    while True:
        try:
            # v190: a auto-atualizacao roda SEMPRE (em TODO PC da frota), nao so no caixa com Sofia.
            # Antes ficava DEPOIS do "if not cfg: continue" -> num PC de cozinha (sem sofia_caixa.json)
            # nunca era alcancada e o PC so pegava versao nova ao REINICIAR. Foi por isso que o pedido
            # #0033 (20/06 17:29) saiu com a correcao de combo v189 (push 17:10) ainda em v187 no PC.
            if time.time() - last_update > SOFIA_UPDATE_EVERY:
                last_update = time.time()
                try: check_update()
                except: pass
            cfg = _sofia_config()
            if not cfg:
                _sofia_avisar("sem_chave", "  SOFIA: este PC NAO tem a chave (Downloads\\sofia_caixa.json) - nao imprime etiquetas do Provisao")
                time.sleep(SOFIA_POLL_INTERVAL); continue
            secret = cfg.get("secret", "")
            base = f"{cfg['url']}/functions/v1/sofia-print-queue"
            # v203: log e "estou vivo" sobem sempre que ha chave (mesmo em pausa ou sem impressora)
            _sofia_enviar_eventos(base, secret, pc)
            if time.time() - ultimo_ping > SOFIA_PING_EVERY:
                ultimo_ping = time.time()
                try: _sofia_http(base, method="POST", body={"action": "ping", "versao": VERSION, "impressora": impressora or ""}, secret=secret, pc=pc)
                except Exception: pass
            if time.time() < pausa_ate:
                time.sleep(SOFIA_POLL_INTERVAL); continue
            _diagnostico_impressoras()   # v208
            if not impressora and time.time() - checou_impressora > 60:
                checou_impressora = time.time()
                impressora = _impressora_caixas_deste_pc()
                if impressora:
                    log(f"  SOFIA: este PC ({pc}) entrou na fila de etiquetas - impressora '{impressora}'")
                    sofia_evento("entrou_fila", impressora=impressora)
                    ultimo_ping = 0   # avisa a nuvem ja no proximo ciclo
            if not impressora:
                if _sofia_avisar("sem_impressora", f"  SOFIA: este PC ({pc}) nao enxerga a impressora das caixas (IP {IP_IMPRESSORA_CAIXAS}) - fica fora da fila"):
                    sofia_evento("sem_impressora", detalhe=IP_IMPRESSORA_CAIXAS)
                time.sleep(SOFIA_POLL_INTERVAL); continue

            q = [f"pc={urllib.parse.quote(pc)}"]
            if secret: q.append(f"secret={urllib.parse.quote(secret)}")
            url = base + ("&" if "?" in base else "?") + "&".join(q)
            data = _sofia_http(url, method="GET", secret=secret, pc=pc)
            pedidos = (data or {}).get("pedidos", [])
            if pedidos:
                impressora = _impressora_caixas_deste_pc() or impressora   # v206: .14 caiu -> .24
                ok_ids, falha_ids = [], []
                numeros = {p.get("id"): str(p.get("numero") or "") for p in pedidos}
                canais = {p.get("id"): str(p.get("canal") or "") for p in pedidos}
                for p in pedidos:
                    pid = p.get("id")
                    if not pid: continue
                    last = _sofia_impressos.get(pid)
                    if last and (time.time() - last) < 60:
                        ok_ids.append(pid)   # impresso há pouco aqui e o mark falhou — só remarca
                        continue
                    if falha_ids:
                        falha_ids.append(pid)  # impressora ja falhou neste lote: devolve o resto sem tentar
                        continue
                    (ok_ids if processar_sofia_pedido(p, impressora) else falha_ids).append(pid)
                if ok_ids:
                    # Marca como impresso SO o que saiu. Se o mark falhar (rede), a reserva vence em 2 min
                    # e o pedido volta; o dedup local de 60s evita reimprimir neste mesmo PC.
                    agora = time.time()
                    for pid in ok_ids: _sofia_impressos[pid] = agora
                    try:
                        resp = _sofia_http(base, method="POST", body={"action": "mark", "ids": ok_ids}, secret=secret, pc=pc)
                        if (resp or {}).get("ok"):
                            log(f"  SOFIA: {len(ok_ids)} pedido(s) impresso(s) e confirmado(s) [{pc}]")
                            for pid in ok_ids: sofia_evento("marcada", {"id": pid, "numero": numeros.get(pid), "canal": canais.get(pid)})
                    except Exception as e:
                        log(f"  SOFIA mark falhou (vai remarcar no proximo ciclo): {e}")
                if falha_ids:
                    try:
                        _sofia_http(base, method="POST", body={"action": "release", "ids": falha_ids}, secret=secret, pc=pc)
                        log(f"  SOFIA: {len(falha_ids)} pedido(s) NAO impresso(s) aqui - devolvido(s) pra fila, outro PC imprime")
                        for pid in falha_ids: sofia_evento("devolvida", {"id": pid, "numero": numeros.get(pid), "canal": canais.get(pid)})
                    except Exception as e:
                        log(f"  SOFIA: devolver pra fila falhou ({e}) - a reserva vence em 2 min e outro PC pega")
                    pausa_ate = time.time() + SOFIA_PAUSA_APOS_FALHA
                    impressora = None   # reconfere a impressora quando voltar
        except Exception as e:
            log(f"  SOFIA poll erro: {e}")
            if _sofia_avisar("poll_erro", "", cada=300):
                sofia_evento("poll_erro", detalhe=e)
        time.sleep(SOFIA_POLL_INTERVAL)

# ============================================================
# COMANDA VIRTUAL - envia o pedido pra fila do CO LOVE (alem de imprimir)
# Vai EMBUTIDO, SEM SENHA: todo PC com este programa ja manda (atualiza pelo GitHub).
# Quem decide se CRIA comanda e o interruptor central no servidor (capture_enabled).
# Best-effort: a impressao SEMPRE acontece antes e NUNCA e afetada por isto.
# Opt-out local opcional: ~/Downloads/comanda_config.json com {"enabled": false} silencia ESTE PC.
# ============================================================
COMANDA_ENDPOINT = "https://vqlfrbugmdnlyxzrlrzt.supabase.co/functions/v1/ingest-comanda"
COMANDA_TYPES    = ["ENTREGA", "RETIRADA", "SALAO"]
COMANDA_CONFIG   = os.path.join(PASTA_DOWNLOADS, "comanda_config.json")  # opt-out local opcional
COMANDA_OUTBOX   = os.path.join(PASTA_FILA, "comanda_outbox")
COMANDA_SENT     = os.path.join(PASTA_FILA, "comanda_sent")
COMANDA_FAILED   = os.path.join(PASTA_FILA, "comanda_failed")
COMANDA_RETRY_INTERVAL = 15        # segundos entre tentativas de reenvio da outbox

def _comanda_local_off():
    """Opt-out: se existir comanda_config.json com enabled=false, ESTE PC nao envia."""
    if not os.path.exists(COMANDA_CONFIG):
        return False
    try:
        with open(COMANDA_CONFIG, "r", encoding="utf-8") as f:
            return json.load(f).get("enabled") is False
    except Exception:
        return False

def _comanda_order_type(balcao, codigo_canal):
    # v1: ENTREGA (delivery) x RETIRADA (balcao/retirada). Salao sera refinado depois.
    return "RETIRADA" if balcao else "ENTREGA"

def _comanda_outbox_path(id_sale):
    ids = re.sub(r'[^A-Za-z0-9_-]', '_', str(id_sale or "sem"))
    return os.path.join(COMANDA_OUTBOX, f"{ids}.json")

def _comanda_post(payload):
    """POST pro endpoint (sem senha; controle e o interruptor central). Retorna (codigo_http, corpo)."""
    headers = {"Content-Type": "application/json"}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(COMANDA_ENDPOINT, data=data, headers=headers, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=8, context=_sofia_ctx())
        return resp.getcode(), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode("utf-8", "replace")
        except: pass
        return e.code, body

def _comanda_try_send_file(fn):
    """Envia UM arquivo da outbox. 2xx (inclui 'pausado') -> sent/. 400/422 -> failed/. Resto -> deixa (retry)."""
    if not os.path.exists(fn):
        return
    try:
        with open(fn, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return
    try:
        code, body = _comanda_post(payload)
    except Exception as e:
        log(f"  COMANDA envio falhou (vai tentar de novo): {e}")
        return
    if 200 <= code < 300:
        os.makedirs(COMANDA_SENT, exist_ok=True)
        try: os.replace(fn, os.path.join(COMANDA_SENT, os.path.basename(fn)))
        except:
            try: os.remove(fn)
            except: pass
        log(f"  COMANDA ok ({code})")
    elif code in (400, 422):
        os.makedirs(COMANDA_FAILED, exist_ok=True)
        try: os.replace(fn, os.path.join(COMANDA_FAILED, os.path.basename(fn)))
        except: pass
        log(f"  COMANDA rejeitada ({code}): {body[:120]}")
    else:
        log(f"  COMANDA HTTP {code}: vai tentar de novo")

def empurrar_comanda(numero_pedido, all_display, total_caixas, total_entrega,
                     pag_cat, balcao, canal, codigo_canal, nome_cliente, hora_pedido, id_sale,
                     force_order_type=None, label_printed=True):
    """Best-effort: poe o pedido na fila do CO LOVE. NUNCA levanta erro (a etiqueta ja saiu).
    Sempre tenta enviar (se nao houver opt-out local); o servidor decide se vira comanda.
    force_order_type: usado pelo salao (SALAO). label_printed: False no salao (Saipos imprime a fisica)."""
    try:
        if total_caixas <= 0 or not id_sale:
            return
        if _comanda_local_off():
            return
        otype = force_order_type or _comanda_order_type(balcao, codigo_canal)
        if otype not in COMANDA_TYPES:
            return
        payload = {
            "version": 1, "id_sale": str(id_sale), "numero_pedido": numero_pedido,
            "order_type": otype, "canal": canal, "codigo_canal": codigo_canal,
            "cliente_nome": nome_cliente, "pagamento_cat": pag_cat, "hora_pedido": hora_pedido,
            "items": all_display, "total_caixas": total_caixas, "total_entrega": total_entrega,
            "label_printed": label_printed,
        }
        fn = _comanda_outbox_path(id_sale)
        os.makedirs(COMANDA_OUTBOX, exist_ok=True)
        tmp = fn + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, fn)
        threading.Thread(target=_comanda_try_send_file, args=(fn,), daemon=True).start()
    except Exception as e:
        log(f"  COMANDA push falhou (ok, etiqueta ja saiu): {e}")

def comanda_retry_loop():
    """Reenvia o que ficou na outbox (ex: internet caiu na hora)."""
    while True:
        try:
            if os.path.isdir(COMANDA_OUTBOX):
                for name in sorted(os.listdir(COMANDA_OUTBOX)):
                    if name.endswith(".json"):
                        _comanda_try_send_file(os.path.join(COMANDA_OUTBOX, name))
        except Exception as e:
            log(f"  COMANDA retry erro: {e}")
        time.sleep(COMANDA_RETRY_INTERVAL)

# ============================================================
# DEBUG -> CO LOVE: manda a "foto" crua de cada pedido (texto do Saipos + o que o script
# entendeu) pra IA diaria do CO LOVE melhorar escrita/exibicao. Best-effort, NUNCA afeta a
# impressao. Gated no servidor por debug_capture_enabled. Mesmo opt-out local da comanda.
# ============================================================
DEBUG_ENDPOINT = "https://vqlfrbugmdnlyxzrlrzt.supabase.co/functions/v1/ingest-debug"
DEBUG_OUTBOX   = os.path.join(PASTA_FILA, "debug_outbox")
DEBUG_SENT     = os.path.join(PASTA_FILA, "debug_sent")
DEBUG_FAILED   = os.path.join(PASTA_FILA, "debug_failed")

def _debug_raw_text(rows):
    out = []
    for row in (rows or []):
        limpo = re.sub(r'<[^>]+>', '', row).strip()
        if limpo: out.append(limpo)
    return "\n".join(out)

def _debug_post(payload):
    headers = {"Content-Type": "application/json"}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(DEBUG_ENDPOINT, data=data, headers=headers, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=8, context=_sofia_ctx())
        return resp.getcode(), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode("utf-8", "replace")
        except: pass
        return e.code, body

def _debug_try_send_file(fn):
    if not os.path.exists(fn): return
    try:
        with open(fn, "r", encoding="utf-8") as f: payload = json.load(f)
    except Exception: return
    try:
        code, body = _debug_post(payload)
    except Exception as e:
        log(f"  DEBUG envio falhou (vai tentar de novo): {e}"); return
    if 200 <= code < 300:
        os.makedirs(DEBUG_SENT, exist_ok=True)
        try: os.replace(fn, os.path.join(DEBUG_SENT, os.path.basename(fn)))
        except:
            try: os.remove(fn)
            except: pass
    elif code in (400, 422):
        os.makedirs(DEBUG_FAILED, exist_ok=True)
        try: os.replace(fn, os.path.join(DEBUG_FAILED, os.path.basename(fn)))
        except: pass
        log(f"  DEBUG rejeitado ({code}): {body[:120]}")
    else:
        log(f"  DEBUG HTTP {code}: vai tentar de novo")

def empurrar_debug(id_sale, numero_pedido, order_type, canal, codigo_canal, rows_all, all_display, totals, meta):
    """Best-effort: manda a foto crua do pedido pro CO LOVE (pra IA diaria). NUNCA levanta erro."""
    try:
        if not id_sale: return
        if _comanda_local_off(): return
        m = dict(meta or {})
        try:
            import socket; m["hostname"] = socket.gethostname()
        except Exception: pass
        payload = {
            "version": 1, "id_sale": str(id_sale), "numero_pedido": numero_pedido,
            "order_type": order_type, "canal": canal, "codigo_canal": codigo_canal,
            "raw_text": _debug_raw_text(rows_all), "parsed_items": all_display or [],
            "totals": totals or {}, "meta": m, "script_version": VERSION,
        }
        ids = re.sub(r'[^A-Za-z0-9_-]', '_', str(id_sale or "sem"))
        fn = os.path.join(DEBUG_OUTBOX, f"{ids}.json")
        os.makedirs(DEBUG_OUTBOX, exist_ok=True)
        tmp = fn + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f: json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, fn)
        threading.Thread(target=_debug_try_send_file, args=(fn,), daemon=True).start()
    except Exception as e:
        log(f"  DEBUG push falhou (ok): {e}")

def debug_retry_loop():
    """Reenvia os logs de debug que ficaram na outbox (ex: internet caiu)."""
    while True:
        try:
            if os.path.isdir(DEBUG_OUTBOX):
                for name in sorted(os.listdir(DEBUG_OUTBOX)):
                    if name.endswith(".json"):
                        _debug_try_send_file(os.path.join(DEBUG_OUTBOX, name))
        except Exception as e:
            log(f"  DEBUG retry erro: {e}")
        time.sleep(COMANDA_RETRY_INTERVAL)

def _migrar_filas_antigas():
    """Tira nossas filas de DADOS de dentro de Downloads/saipos (a entrada do Saipos Printer).
    Move o que sobrou pra ~/colove_fila e apaga as subpastas antigas, pra nao poluir o Saipos Printer."""
    pares = [("comanda_outbox", COMANDA_OUTBOX), ("comanda_sent", COMANDA_SENT), ("comanda_failed", COMANDA_FAILED),
             ("debug_outbox", DEBUG_OUTBOX), ("debug_sent", DEBUG_SENT), ("debug_failed", DEBUG_FAILED)]
    movidos = 0
    for nome_antigo, novo in pares:
        antigo = os.path.join(PASTA_SAIPOS, nome_antigo)
        if not os.path.isdir(antigo):
            continue
        try:
            os.makedirs(novo, exist_ok=True)
            for nome in os.listdir(antigo):
                src = os.path.join(antigo, nome)
                try:
                    if os.path.isfile(src):
                        os.replace(src, os.path.join(novo, nome)); movidos += 1
                except Exception:
                    pass
            try: os.rmdir(antigo)
            except Exception: pass
        except Exception:
            pass
    if movidos:
        log(f"  LIMPEZA: {movidos} arquivo(s) de fila tirado(s) da pasta do Saipos Printer")

# ============================================================
# REGRAS (dicionario da IA) -> aplica na escrita dos itens. So vem regra do servidor se
# debug_apply_rules=true (senao a edge devolve vazio = comportamento de hoje, byte a byte).
# ============================================================
RULES_ENDPOINT = "https://vqlfrbugmdnlyxzrlrzt.supabase.co/functions/v1/get-etiqueta-rules"
RULES_REFRESH_INTERVAL = 600  # 10 min
_REGRAS = {"rules": []}
_REGRAS_LOCK = threading.Lock()
_TIPOS_TEXTO = ("encoding", "sabor_alias", "borda_cleanup", "abbrev")

def _carregar_regras():
    """Best-effort: busca o dicionario ativo. Se falhar, mantem o cache atual."""
    try:
        req = urllib.request.Request(RULES_ENDPOINT, headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=8, context=_sofia_ctx())
        data = json.loads(resp.read().decode("utf-8", "replace"))
        rules = data.get("rules") if isinstance(data, dict) else None
        if isinstance(rules, list):
            with _REGRAS_LOCK: _REGRAS["rules"] = rules
            if rules: log(f"  REGRAS: {len(rules)} ativa(s)")
    except Exception as e:
        log(f"  REGRAS fetch (ok, usa cache): {e}")

def regras_refresh_loop():
    while True:
        _carregar_regras()
        time.sleep(RULES_REFRESH_INTERVAL)

def _aplica_uma_regra(texto, regra):
    # LITERAL por seguranca: str.replace e O(n), sem risco de ReDoS (re.sub nao tem timeout) nem
    # de backreference no replacement. is_regex e ignorado de proposito (regex desabilitado no servidor).
    try:
        mp = regra.get("match_pattern") or ""
        if not mp: return texto
        rep = regra.get("replacement"); rep = "" if rep is None else str(rep)
        return texto.replace(mp, rep)
    except Exception:
        return texto

def aplicar_regras_texto(texto, alvo):
    """Aplica regras de TEXTO (encoding/sabor_alias/borda_cleanup/abbrev) que valem pro alvo."""
    if not texto: return texto
    with _REGRAS_LOCK: regras = list(_REGRAS["rules"])
    if not regras: return texto
    s = texto
    for tipo in _TIPOS_TEXTO:               # ordem importa: conserta -> padroniza -> encurta
        if tipo == "abbrev" and alvo != "etiqueta": continue  # abreviar so na etiqueta (comanda tem espaco)
        for r in regras:
            if r.get("rule_type") != tipo: continue
            tg = r.get("target") or "ambos"
            if tg != "ambos" and tg != alvo: continue
            s = _aplica_uma_regra(s, r)
    return s

def aplicar_regras_display(display, alvo):
    """Copia do display com nome/sabores normalizados. SEM regras = MESMO objeto (no-op total)."""
    with _REGRAS_LOCK: tem = bool(_REGRAS["rules"])
    if not tem: return display
    out = []
    for it in (display or []):
        novo = dict(it)
        if novo.get("nome"): novo["nome"] = aplicar_regras_texto(str(novo["nome"]), alvo)
        if isinstance(novo.get("sabores"), list):
            novo["sabores"] = [aplicar_regras_texto(str(x), alvo) for x in novo["sabores"]]
        out.append(novo)
    return out

def main():
    print("=" * 60)
    print(f"  ETIQUETA SAIPOS -> ELGIN L42PRO FULL  (v{VERSION})")
    print("  Pizzaria Estrela da Ilha - BOPP 80x30mm")
    print("=" * 60 + "\n")
    print(f"  Usuario:     {os.path.expanduser('~')}")
    print(f"  Monitorando: {PASTA_DOWNLOADS}")
    print(f"  Impressora:  {NOME_IMPRESSORA}")
    print(f"  Caixas:      {LARGURA_MM}x{ALTURA_MM}mm  (IP {IP_IMPRESSORA_CAIXAS})")
    print(f"  CO LOVE:     {CO_LOVE_LARGURA_MM}x{CO_LOVE_ALTURA_MM}mm  (IP {IP_IMPRESSORA_PRODUCAO})\n")
    print("  Verificando atualizacoes..."); check_update(); print()
    if not os.path.exists(PASTA_DOWNLOADS):
        print(f"  ERRO: Pasta nao encontrada: {PASTA_DOWNLOADS}"); input("  Enter para sair..."); return
    os.makedirs(PASTA_SAIPOS, exist_ok=True)
    os.makedirs(PASTA_FILA, exist_ok=True)
    _migrar_filas_antigas()  # tira nossas filas de dentro da pasta do Saipos Printer (conserto salao)
    print("  Aguardando pedidos do Saipos...\n  (Ctrl+C para parar)\n")
    log(f"Script v{VERSION} iniciado - {LARGURA_MM}x{ALTURA_MM}mm")
    handler = SaiposHandler(); observer = Observer()
    observer.schedule(handler, PASTA_DOWNLOADS, recursive=False); observer.start()
    # SOFIA: poller de pedidos por telefone (so atua se existir sofia_caixa.json em Downloads)
    threading.Thread(target=sofia_poll_loop, daemon=True).start()
    # CO LOVE: reenvio da fila de comandas (so age se existir comanda_config.json ligado)
    threading.Thread(target=comanda_retry_loop, daemon=True).start()
    # CO LOVE: reenvio dos logs de debug pra IA (so cria dado se ligado no servidor)
    threading.Thread(target=debug_retry_loop, daemon=True).start()
    # CO LOVE: dicionario de regras da IA (so vem regra se debug_apply_rules=true; senao no-op)
    _carregar_regras()
    threading.Thread(target=regras_refresh_loop, daemon=True).start()
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt: log("Script encerrado"); observer.stop()
    observer.join()

if __name__ == "__main__": main()
