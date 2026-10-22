# Frota de etiquetas — Pizzaria Estrela da Ilha

Repositório PÚBLICO de distribuição do auto-update dos PCs de etiqueta e do robô do terminal.
Contém SÓ os 2 scripts (sem senhas — as credenciais vivem em arquivos locais de cada PC).
O app Vigia mora em repositório privado; este existe porque a frota se atualiza pela URL raw pública.

## Copa: versão 243

O envio da copa usa a mesma imagem do recibo, mas com comandos de imagem em RAM
`GS *` e `GS /`, documentados pela Bematech nos modos ESC/Bema e ESC/POS.
As faixas de 24 pontos são menores que 2 KB e têm cadência de 40 ms. O trabalho
inicializa a impressora e corta uma vez. Não grava configuração permanente.
O destino do cupom fiscal continua usando seu protocolo anterior.

Referência técnica: Manual de Programação Bematech MP-4200 TH, revisão 1.0,
capítulos ESC/Bema (páginas impressas 28) e ESC/POS (57–58).
https://www.bztech.com.br/arquivos/manual-programacao-bematech-mp-4200-th.pdf

Testes de recibos verificam a imagem pixel a pixel após decodificar o protocolo,
limites dos blocos, bordas entre faixas, corte único, destino fiscal e falha durante
o envio. O evento `salao_enviado` registra protocolo, blocos e quantidade de bytes.
Esse evento confirma transporte concluído, não leitura física do papel.

## Cupons do salão: versão 244

O mesmo envio em faixas pequenas passa a ser usado também nos resumos e DANFE do
caixa do salão. A imagem continua sendo renderizada do DANFE oficial e o transporte
não emite nem cancela notas. O evento de envio inclui também largura e altura.

A reserva do Provisão deve serializar todos os trabalhos por destino físico:
`caixa_salao` não pode ser reservado por outro PC enquanto houver um envio ativo.
A copa mantém seu intervalo de cinco segundos; o caixa aguarda dois segundos após
o reconhecimento de envio. A atualização do banco é publicada pelo repositório do
Provisão; a versão do helper é distribuída por esta URL pública.
