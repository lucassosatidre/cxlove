import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("etiqueta_saipos", ROOT / "etiqueta_saipos.py")
ETQ = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ETQ)


def grupo_escolhas(*nomes):
    return [{
        "items": {"1": {
            "desc_sale_item": "Pizza Broto Combo",
            "quantity": 1,
            "deleted": "N",
            "choice_items": {
                str(i): {"desc_sale_item_choice": nome, "deleted": "N", "choice_item": {"id_store_choice": 1}}
                for i, nome in enumerate(nomes, start=1)
            },
        }}
    }]


def test_mesa_49_nao_inventa_caixa_para_insumo():
    itens = ETQ.extrair_itens_kds(grupo_escolhas(
        "Pizza Broto de Nutella com Morango",
        "Morango - fruta congelada",
    ))
    caixas = [x for x in itens if x["tipo"] in ("caixa_salgada", "caixa_doce")]
    assert len(caixas) == 1
    assert caixas[0]["sabores"] == ["Nutella com Morango"]
    assert any(x["tipo"] == "outro" and "Conferir: Morango - fruta congelada" in x["nome"] for x in itens)


def test_textos_fora_do_catalogo_nunca_viram_sabor_ou_caixa():
    for texto in ("Leite Condensado", "Granulado", "Morango - fruta congelada"):
        itens = ETQ.extrair_itens_kds(grupo_escolhas(texto))
        assert not any(texto in str(x.get("sabores")) for x in itens)
        assert any(x["tipo"] == "outro" and "Conferir:" in x["nome"] for x in itens)


def test_nome_com_permanece_por_extenso():
    assert ETQ.abreviar_sabor("Frango com Catupiry") == "Frango com Catupiry"


def test_codigo_do_catalogo_resolve_nome_canonico():
    hit = ETQ._catalogo_salao_resolver("nome comercial qualquer", "15020260.13963971")
    assert hit == {"tipo": "adicional", "nome": "Adicional de Catupiry"}
