"""v214: etiqueta de MESA (salao) — uma por pizza/pote, 50x25, sem pagamento."""
import importlib.util
import pathlib
import unittest

ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"
SPEC = importlib.util.spec_from_file_location("etiqueta_saipos_mesa", ARQUIVO)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

ELEMENTO_SAIPOS = """MESA MESA
25/set - 19:00
Garçom: Cleber
Mesa: 50
Comanda: 4
Identificação: 18.01Ana Paula - 2/3
Qt.Descrição
1  Pizza Grande
-1/2 Frango com Catupiry
-1/2 Portuguesa
-1 Coca Cola 2l
** massa bem assada **
1  Pote Dip Cheddar
Quantidade de itens:               2
Mesa: 50""".split("\n")

PEDIDO_PROVISAO = {
    "id": "x", "numero": "12", "tipo": "salao", "formato": "mesa", "canal": "Salao",
    "mesa": 12, "nome_cliente": "Mesa 12 · João", "salao_cliente": "João",
    "hora": "2026-09-25T22:00:00+00:00",
    "itens": [
        {"qtd": 2, "nome": "Pizza Gigante", "tipo": "pizza", "categoria": "salgada",
         "sabores": [{"nome": "Calabresa", "fracao": "2/3"}, {"nome": "Portuguesa", "fracao": "1/3"}]},
        {"qtd": 1, "nome": "Pote Dip Cheddar", "tipo": "dip"},
        {"qtd": 3, "nome": "Coca Cola 2l", "tipo": "bebida"},
    ],
}


class EtiquetaMesaTest(unittest.TestCase):
    def test_saipos_elemento_vira_uma_etiqueta_por_produto_sem_bebida(self):
        disp = MOD.agrupar_display(MOD.extrair_itens_salao(ELEMENTO_SAIPOS))
        uni = MOD.etiquetas_mesa_unidades(disp)
        self.assertEqual(len(uni), 2)                                  # pizza + pote
        tipos = [d[0]["tipo"] for d, _ in uni]
        self.assertEqual(tipos, ["caixa_salgada", "dip"])
        for d, _ in uni:
            self.assertFalse(any(x["tipo"] == "bebida" for x in d))     # bebida nao vai na assadeira
        self.assertEqual(MOD.extrair_mesa(ELEMENTO_SAIPOS), "50")
        self.assertEqual(MOD._mesa_nome_conta(MOD.extrair_identificacao(ELEMENTO_SAIPOS)), "Ana Paula")

    def test_texto_da_mesa(self):
        self.assertEqual(MOD._mesa_txt("50"), "MESA 50")
        self.assertEqual(MOD._mesa_txt("Mesa: 18.01"), "MESA 18")
        self.assertEqual(MOD._mesa_txt(12), "MESA 12")
        self.assertEqual(MOD._mesa_txt(""), "MESA")
        self.assertEqual(MOD._mesa_nome_conta("Marcio - 1/2"), "Marcio")
        self.assertEqual(MOD._mesa_nome_conta(""), "")

    def test_desenho_50x25_sem_pagamento(self):
        disp = MOD.agrupar_display(MOD.extrair_itens_salao(ELEMENTO_SAIPOS))
        uni = MOD.etiquetas_mesa_unidades(disp)
        img = MOD.gerar_etiqueta_mesa("50", uni[0][0], 1, 2, nome_conta="Ana", hora="19:00")
        self.assertEqual(img.size, (MOD.CO_LOVE_LARGURA_PX, MOD.CO_LOVE_ALTURA_PX))
        self.assertEqual(MOD._mesa_nome_produto(uni[1][0][0]), "POTE DIP CHEDDAR")

    def test_provisao_pedido_de_salao_e_mesa(self):
        self.assertTrue(MOD._sofia_eh_mesa(PEDIDO_PROVISAO))
        self.assertTrue(MOD._sofia_eh_mesa({"tipo": "salao"}))
        self.assertFalse(MOD._sofia_eh_mesa({"tipo": "entrega"}))
        uni = MOD.etiquetas_mesa_unidades(MOD.sofia_display(PEDIDO_PROVISAO["itens"]))
        self.assertEqual(len(uni), 3)                                  # 2 gigantes + 1 pote
        self.assertTrue(all(d[0]["qty"] == 1 for d, _ in uni))

    def test_provisao_sem_pizza_marca_impresso_e_nao_imprime(self):
        chamadas = []
        orig = MOD.imprimir_etiqueta_producao
        MOD.imprimir_etiqueta_producao = lambda *a, **k: chamadas.append(a)
        try:
            p = dict(PEDIDO_PROVISAO, itens=[{"qtd": 1, "nome": "Coca", "tipo": "bebida"}])
            self.assertTrue(MOD.processar_sofia_mesa(p))
            self.assertEqual(chamadas, [])
        finally:
            MOD.imprimir_etiqueta_producao = orig

    def test_provisao_sem_impressora_24_volta_pra_fila(self):
        orig_nome, orig_inst = MOD._nome_por_ip, MOD._instalar_impressora_24
        MOD._nome_por_ip = lambda ip: None
        MOD._instalar_impressora_24 = lambda: None
        try:
            self.assertFalse(MOD.processar_sofia_mesa(PEDIDO_PROVISAO))
        finally:
            MOD._nome_por_ip, MOD._instalar_impressora_24 = orig_nome, orig_inst

    def test_provisao_imprime_uma_por_unidade_na_24(self):
        chamadas = []
        orig = (MOD._nome_por_ip, MOD.imprimir_etiqueta_producao, MOD.time.sleep)
        MOD._nome_por_ip = lambda ip: "producao 24 (etiquetas)" if ip == MOD.IP_IMPRESSORA_PRODUCAO else None
        MOD.imprimir_etiqueta_producao = lambda img, imp, copias=1: chamadas.append((imp, copias, img.size))
        MOD.time.sleep = lambda s: None
        try:
            self.assertTrue(MOD.processar_sofia_mesa(PEDIDO_PROVISAO))
            self.assertEqual(len(chamadas), 3)
            self.assertTrue(all(c[0] == "producao 24 (etiquetas)" and c[1] == 1 for c in chamadas))
        finally:
            MOD._nome_por_ip, MOD.imprimir_etiqueta_producao, MOD.time.sleep = orig


if __name__ == "__main__":
    unittest.main()
