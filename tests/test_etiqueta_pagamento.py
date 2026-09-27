import importlib.util
import pathlib
import unittest


ARQUIVO = pathlib.Path(__file__).resolve().parents[1] / "etiqueta_saipos.py"
SPEC = importlib.util.spec_from_file_location("etiqueta_saipos", ARQUIVO)
MOD = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MOD)


class EtiquetaPagamentoTest(unittest.TestCase):
    # v213: regras do Lucas (25/09/26)
    def rod(self, *a, **k):
        cat, dados = MOD.sofia_pag_cat(*a, **k)
        return cat, MOD.montar_rodape_linha(1, cat, dados)

    def test_ifood_pago_sai_so_pago(self):
        cat, r = self.rod("pago", None, 50.90, pagamentos=[{"forma": "credito", "valor": 50.90}], bandeira="MASTERCARD")
        self.assertEqual(cat, "PAGO"); self.assertEqual(r, "ITENS: 1 - PAGO")

    def test_cartao_pix_vale_na_entrega_viram_maq_cartao(self):
        for forma in ("credito", "debito", "pix", "vale"):
            cat, r = self.rod(forma, None, 91.40, pagamentos=[{"forma": forma, "valor": 91.40}], bandeira="VISA")
            self.assertEqual(cat, "COBRAR_DETALHE"); self.assertEqual(r, "ITENS: 1 - MAQ CARTAO R$91,40")

    def test_brendi_pix_pago_no_app_e_pago(self):
        cat, r = self.rod("pix", None, 66.30, pagamentos=[{"forma": "pix", "valor": 66.30, "online": True}])
        self.assertEqual(r, "ITENS: 1 - PAGO")

    def test_brendi_pix_na_entrega_e_maq_cartao(self):
        cat, r = self.rod("pix", None, 66.30, pagamentos=[{"forma": "pix", "valor": 66.30, "online": False}])
        self.assertEqual(r, "ITENS: 1 - MAQ CARTAO R$66,30")

    def test_dinheiro_com_troco(self):
        cat, r = self.rod("dinheiro", 140, 135.39, pagamentos=[{"forma": "dinheiro", "valor": 135.39}])
        self.assertEqual(r, "ITENS: 1 - DIN R$135,39 TROCO P/ R$140,00")

    def test_dinheiro_troco_igual_ao_valor_nao_mostra_troco(self):
        cat, r = self.rod("dinheiro", 203, 203, pagamentos=[{"forma": "dinheiro", "valor": 203}])
        self.assertEqual(r, "ITENS: 1 - DIN R$203,00")

    def test_misto(self):
        cat, r = self.rod("dinheiro", 100, 135.39, pagamentos=[
            {"forma": "dinheiro", "valor": 85.39}, {"forma": "credito", "valor": 50}])
        self.assertEqual(r, "ITENS: 1 - MAQ CARTAO R$50,00 DIN R$85,39 TROCO P/ R$100,00")

    def test_pedido_zero_e_pago(self):
        for forma in ("other", "dinheiro", "credito"):
            cat, r = self.rod(forma, None, 0, pagamentos=[{"forma": forma, "valor": 0, "online": False}])
            self.assertEqual(r, "ITENS: 1 - PAGO")

    def test_estrelas(self):
        cat, r = self.rod("credito", None, 19.90, pagamentos=[{"forma": "credito", "valor": 19.90, "online": False}], estrelas=True)
        self.assertEqual(cat, "COBRAR_DETALHE"); self.assertEqual(r, "ITENS: 1 - RECOLHER 10 ESTRELAS + MAQ CARTAO R$19,90")
        cat, r = self.rod("dinheiro", None, 0, pagamentos=[{"forma": "dinheiro", "valor": 0}], estrelas=True)
        self.assertEqual(cat, "COBRAR_DETALHE"); self.assertEqual(r, "ITENS: 1 - RECOLHER 10 ESTRELAS")

    def test_estrelas_por_canal(self):
        # 27/09/26: pedido #0018 da Luci com JUNTE10TELE saiu sem o aviso (so valia pro Atendente)
        self.assertTrue(MOD.sofia_tem_estrelas("Luci", "JUNTE10TELE"))
        self.assertTrue(MOD.sofia_tem_estrelas("Atendente", " junte10tele "))
        self.assertFalse(MOD.sofia_tem_estrelas("Brendi", "JUNTE10TELE"))
        self.assertFalse(MOD.sofia_tem_estrelas("iFood", "JUNTE10TELE"))
        self.assertFalse(MOD.sofia_tem_estrelas("Luci", "ESTRELA10"))
        self.assertFalse(MOD.sofia_tem_estrelas("Luci", None))

    def test_obs_de_pizza_so_na_etiqueta_dela(self):
        d = MOD.sofia_display([
            {"tipo": "pizza", "nome": "Pizza Gigante", "qtd": 1, "sabores": [{"fracao": "1/3", "nome": "Portuguesa"}]},
            {"tipo": "pizza", "nome": "Pizza Broto", "qtd": 1, "sabores": [{"fracao": "1/1", "nome": "Calabresa"}]},
            {"tipo": "outro", "nome": "Obs: Gigante · 1/3 Portuguesa: sem presunto", "qtd": 1},
            {"tipo": "outro", "nome": "Obs: sem cebola", "qtd": 1},
        ])
        u = MOD.sofia_etiquetas_unitarias(d)
        nomes = [[x["nome"] for x in disp] for disp, _ in u]
        self.assertIn("Obs: Gigante · 1/3 Portuguesa: sem presunto", nomes[0])
        self.assertNotIn("Obs: Gigante · 1/3 Portuguesa: sem presunto", nomes[1])
        self.assertIn("Obs: sem cebola", nomes[0]); self.assertIn("Obs: sem cebola", nomes[1])

    def test_rodape_longo_cabe_em_2_linhas(self):
        d = MOD.sofia_display([{"tipo": "pizza", "nome": "Pizza Grande", "qtd": 1, "sabores": [], "qr": ["EQ7K3M9P2R4T"]}])
        disp, qr = MOD.sofia_etiquetas_unitarias(d)[0]
        cat, dados = MOD.sofia_pag_cat("dinheiro", 100, 160, pagamentos=[
            {"forma": "credito", "valor": 80}, {"forma": "dinheiro", "valor": 80}])
        img = MOD.gerar_etiqueta("1", 1, 1, disp, 1, cat, dados, False, "ATENDENTE", "", "", "21:40", qr_texto=qr, unitario=True)
        self.assertEqual(img.size, (MOD.LARGURA_PX, MOD.ALTURA_PX))

    def test_payload_provisao_conta_dip_e_nao_cria_etiqueta_para_refri(self):
        display = MOD.sofia_display([
            {"tipo": "pizza", "nome": "Pizza Grande", "qtd": 1, "sabores": [{"fracao": "1/1", "nome": "Calabresa"}]},
            {"tipo": "dip", "nome": "Pote Dip Catupiry", "qtd": 1},
            {"tipo": "bebida", "nome": "Coca Cola 1,5l", "qtd": 1},
        ])
        self.assertEqual([item["tipo"] for item in display], ["caixa_salgada", "dip", "bebida"])
        total_caixas, total_dips, total_bebidas, total_outros, total_entrega, total_etiquetas = MOD.sofia_totais(display)
        self.assertEqual((total_caixas, total_dips, total_bebidas, total_outros), (1, 1, 1, 0))
        self.assertEqual(total_entrega, 3)
        self.assertEqual(total_etiquetas, 2)

        so_refri = MOD.sofia_display([{"tipo": "bebida", "nome": "Coca Cola 1,5l", "qtd": 1}])
        self.assertEqual(MOD.sofia_totais(so_refri)[-1], 0)


if __name__ == "__main__":
    unittest.main()
