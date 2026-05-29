# Tool `finalizar_pedido` — captura do pedido da Sofia (Caixa Love)

Esta é a ferramenta que a Sofia (Lucinéia v9) deve chamar **no fim da ligação**, quando o
pedido estiver fechado e confirmado com o cliente. Ela grava o pedido estruturado no
Caixa Love (cxlove), que então imprime comanda + etiquetas na cozinha.

> Se a Sofia **não** chamar esta tool, o sistema tem um plano B: a IA lê a transcrição da
> ligação depois que ela termina e monta o pedido sozinha. Mas a tool é o jeito **certo e
> exato** — configurá-la deixa o pedido 100% fiel ao que a Sofia confirmou.

## Endpoint (Custom Mid-Call Tool)

- **Método:** POST
- **URL:** `https://hvpmkkxvvjnefayrlcjy.supabase.co/functions/v1/sofia-tools-callback?tool=finalizar_pedido`
- **Header (se o secret estiver ativo):** `x-sofia-webhook-secret: <SOFIA_WEBHOOK_SECRET>`
- **Body:** os argumentos abaixo (JSON)

A resposta volta `{ ok: true, result: { sucesso, numero_pedido, status, total, mensagem } }`.
A Sofia pode falar pro cliente: "Seu pedido número {numero_pedido} foi registrado!".

## Argumentos

```json
{
  "nome_cliente": "Ana Julieta",
  "telefone": "48999999999",
  "tipo": "entrega",                       // "entrega" ou "retirada"
  "endereco": "Rua das Flores, 27",
  "bairro": "Campeche",
  "complemento": "ap 202",                 // opcional
  "referencia": "perto do mercado",        // opcional
  "taxa_entrega": 0,                        // R$, conforme o bairro
  "forma_pagamento": "dinheiro",           // "dinheiro" | "maquininha" | "pix" | "pago"
  "troco_para": 100,                        // só se for dinheiro e precisar de troco; senão 0
  "observacoes": "sem cebola",             // opcional
  "total": 137.90,
  "itens": [
    {
      "tipo": "pizza",
      "nome": "Pizza Grande",
      "qtd": 1,
      "tamanho": "grande",                  // broto | grande | gigante
      "categoria": "salgada",               // salgada | doce
      "sabores": [
        { "fracao": "1/2", "nome": "Calabresa" },
        { "fracao": "1/2", "nome": "Frango com Catupiry" }
      ],
      "borda": "Catupiry",                   // opcional
      "valor": 90.00
    },
    {
      "tipo": "bebida",
      "nome": "Coca-Cola 1,5L",
      "qtd": 1,
      "valor": 0
    }
  ]
}
```

### Regras importantes pra Sofia montar os `itens`
- **Um item por pizza física.** Um Combo 1 (2 pizzas grandes + refri) vira **3 itens**:
  pizza grande #1, pizza grande #2 e a bebida. Isso garante uma etiqueta por caixa.
- **Pizza inteira de 1 sabor:** um único sabor, sem `fracao` (ou `"1/1"`).
- **Meio a meio (grande):** 2 sabores com `fracao` `"1/2"` cada.
- **Gigante 3 sabores:** `fracao` `"1/3"` cada (ou `"2/4"`/`"1/2"` conforme dividiu).
- Use os nomes de sabor **exatamente** como no cardápio (tabela `sofia_menu`).
- `valor` é o total da linha (com adicionais). `total` é o valor a cobrar (itens + taxa).

## Como aparece no Caixa Love
O pedido cai na aba **Sofia → Caixa**. Com o "Modo automático" **desligado**, ele espera
conferência e impressão manual. **Ligado**, vai direto pra impressora da cozinha.
