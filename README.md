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
