import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import ImageChops, ImageDraw

spec = importlib.util.spec_from_file_location('consumo_legivel', Path(__file__).resolve().parents[1] / 'etiqueta_saipos.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

PEDIDO = {'tipo':'resumo','titulo':'CONSUMO DA MESA — NÃO FISCAL','cliente':'Mesa 49 · 1 comanda(s)',
 'hora':'2026-11-03T02:19:00Z','consumo':168.33,'consumo_pago':0,'total':168.33,'servico':True,
 'itens':[{'tipo':'obs','nome':'COMANDA: MESA-49-33'},
 {'tipo':'pizza','nome':'Pizza Broto Doce (Aniversário)','qty':1,'sabores':['Sensação Ao Leite'],'preco_total':0},
 {'tipo':'obs','nome':'Aniversário'},
 {'tipo':'bebida','nome':'Coca Cola Zero 350ml','qty':3,'preco_total':30},
 {'tipo':'obs','nome':'Coca Cola Zero 350ml: Copos: 1'},
 {'tipo':'bebida','nome':'Macrovita de laranja - 300ml','qty':2,'preco_total':24},
 {'tipo':'pizza','nome':'Pizza Gigante','qty':1,'preco_total':107.33,
  'sabores':['1/3 Calabresa com Cebola','1/3 Frango Especial 2.0','1/3 Muçarela com Milho']},
 {'tipo':'obs','nome':'Favor não fazer essa pizza'},
 {'tipo':'bebida','nome':'Água sem Gás 500ml','qty':1,'preco_total':7}]}

class Consumo(unittest.TestCase):
 def test_agrupa_iguais_sem_misturar_comandas_preco_pagamento_ou_observacoes(self):
  import copy
  itens=[{'tipo':'obs','nome':'COMANDA: Ana'}]
  def bebida(obs='Água: Copos: 1',preco=7,pago=False):
   return [{'tipo':'bebida','nome':'Água','qty':1,'preco_total':preco,'pago':pago}, {'tipo':'obs','nome':obs}]
  itens+=bebida()+bebida()+bebida('Água: sem gelo')+bebida(preco=8)+bebida(pago=True)
  itens+=[{'tipo':'obs','nome':'Consumo da comanda: R$ 36,00'}, {'tipo':'obs','nome':'TOTAL COMANDA: R$ 39,60','resumo_total_comanda':True}, {'tipo':'obs','nome':'COMANDA: Bia'}]
  itens+=bebida()+bebida()+bebida()
  antes=copy.deepcopy(itens)
  blocos=mod.salao_consumo_blocos({**PEDIDO,'itens':itens})
  self.assertEqual(itens,antes)
  self.assertEqual([t for tipo,t in blocos if tipo=='produto'],['2x Água','1x Água','1x Água','PAGO · 1x Água','3x Água'])
  self.assertEqual(sum(tipo=='separador' for tipo,_ in blocos),1)
  self.assertIn(('observacao','sem gelo'),blocos)
  self.assertNotIn('Água: Copos: 1',str(blocos))
  self.assertIn(('valor','R$ 14,00'),blocos)
  self.assertIn(('valor','R$ 21,00'),blocos)
 def test_agrupa_ultimo_item_mesmo_com_subtotais_e_preserva_sabores(self):
  itens=[{'tipo':'obs','nome':'COMANDA: teste'},
   {'tipo':'pizza','nome':'Pizza Grande','sabores':['Calabresa'],'qty':1,'preco_total':70},
   {'tipo':'pizza','nome':'Pizza Grande','sabores':['Muçarela'],'qty':1,'preco_total':70},
   {'tipo':'pizza','nome':'Pizza Grande','sabores':['Calabresa'],'qty':1,'preco_total':70},
   {'tipo':'obs','nome':'Consumo da comanda: R$ 210,00'},
   {'tipo':'obs','nome':'Serviço (10%): R$ 21,00'},
   {'tipo':'obs','nome':'TOTAL COMANDA: R$ 231,00','resumo_total_comanda':True}]
  blocos=mod.salao_consumo_blocos({**PEDIDO,'itens':itens})
  self.assertEqual([t for tipo,t in blocos if tipo=='produto'],['2x Pizza Grande','1x Pizza Grande'])
  self.assertIn(('sabor','Calabresa'),blocos)
  self.assertIn(('sabor','Muçarela'),blocos)
  self.assertIn(('total_comanda','TOTAL COMANDA: R$ 231,00'),blocos)
  with patch.object(ImageDraw.ImageDraw,'line') as linha:
   mod.salao_resumo_img({**PEDIDO,'itens':itens})
  linha.assert_not_called()
 def test_total_por_comanda_em_destaque_e_soma_geral(self):
  itens=[]
  for nome,consumo,total in [('teste',26,28.6),('teste 2',29,31.9),('teste 3',29,31.9)]:
   itens.extend([{'tipo':'obs','nome':'COMANDA: '+nome},
    {'tipo':'bebida','nome':'Produtos desta comanda','qty':1,'preco_total':consumo},
    {'tipo':'obs','nome':f'TOTAL COMANDA: R$ {total:.2f}'.replace('.',','),'resumo_total_comanda':True}])
  p={**PEDIDO,'itens':itens,'total':84,'consumo':84,'servico_valor':8.4,'comandas_totalizadas':True}
  blocos=mod.salao_consumo_blocos(p)
  self.assertEqual([t for tipo,t in blocos if tipo=='total_comanda'],['TOTAL COMANDA: R$ 28,60','TOTAL COMANDA: R$ 31,90','TOTAL COMANDA: R$ 31,90'])
  self.assertIn(('total','TOTAL GERAL: R$ 92,40'),blocos)
  self.assertLess(blocos.index(('total_comanda','TOTAL COMANDA: R$ 28,60')),blocos.index(('comanda','COMANDA: teste 2')))
  img=mod.salao_resumo_img(p)
  self.assertLessEqual(ImageChops.invert(img.convert('L')).getbbox()[2],561)
 def test_preserva_taxa_exata_informada_no_geral(self):
  blocos=mod.salao_consumo_blocos({**PEDIDO,'total':10.15,'servico_valor':1.02,'comandas_totalizadas':True})
  self.assertIn(('total','TOTAL GERAL: R$ 11,17'),blocos)
 def test_historico_mostra_quitado_com_taxa_real_sem_recalcular(self):
  p={**PEDIDO,'total':0,'servico':False,'fechamento':{'total':88,'consumo':100,'servico':8,'desconto':20,'composicao_conferida':True},
     'itens':[{'tipo':'bebida','nome':'Consumo histórico','qty':1,'preco_total':100},
              {'tipo':'obs','nome':'Resumo antigo','resumo_fechamento':True}]}
  blocos=mod.salao_consumo_blocos(p)
  self.assertIn(('total','TOTAL QUITADO: R$ 88,00'),blocos)
  self.assertIn(('subtotal','Serviço cobrado: R$ 8,00'),blocos)
  self.assertIn(('subtotal','Desconto: R$ 20,00'),blocos)
  self.assertNotIn('Resumo antigo',str(blocos))
  self.assertNotIn(('total','A PAGAR: R$ 88,00'),blocos)
 def test_historico_sem_composicao_nao_inventa_taxa(self):
  blocos=mod.salao_consumo_blocos({**PEDIDO,'fechamento':{'total':100,'composicao_conferida':False}})
  self.assertIn(('total','TOTAL QUITADO: R$ 100,00'),blocos)
  self.assertFalse(any('Serviço cobrado' in t for _,t in blocos))
  self.assertTrue(any('não disponível' in t for _,t in blocos))
 def test_blocos_preservam_itens_e_separam_observacoes(self):
  blocos=mod.salao_consumo_blocos(PEDIDO)
  self.assertEqual(sum(t=='produto' for t,_ in blocos),5)
  self.assertEqual(sum(t=='separador' for t,_ in blocos),0)
  pos=blocos.index(('produto','3x Coca Cola Zero 350ml'))
  self.assertEqual(blocos[pos+1],('valor','R$ 30,00'))
  self.assertFalse(any('Copos: 1' in texto for _,texto in blocos))
  self.assertIn(('total','A PAGAR: R$ 185,16'),blocos)
  self.assertIn(('subtotal','Serviço (10%): R$ 16,83'),blocos)
 def test_fontes_maiores_e_todo_texto_cabe_no_papel(self):
  original=ImageDraw.ImageDraw.text
  textos=[]
  def texto(draw,xy,text,*args,**kwargs):
   font=kwargs['font'];bb=draw.textbbox(xy,text,font=font)
   textos.append((text,font.size,bb))
   return original(draw,xy,text,*args,**kwargs)
  with patch.object(ImageDraw.ImageDraw,'text',texto):
   img=mod.salao_resumo_img(PEDIDO)
  self.assertEqual(img.width,576)
  self.assertTrue(any('Coca Cola' in t and s==38 for t,s,_ in textos))
  self.assertTrue(any(t=='R$ 30,00' and s==32 for t,s,_ in textos))
  self.assertTrue(any(t.startswith('A PAGAR') and s==42 for t,s,_ in textos))
  self.assertTrue(all(16<=b[0] and b[2]<=560 and 0<=b[1]<b[3]<img.height for _,_,b in textos))
  self.assertLessEqual(ImageChops.invert(img.convert('L')).getbbox()[2],561)
 def test_nao_exibe_cancelado_e_nao_recalcula_preco_do_item(self):
  p={**PEDIDO,'itens':[{'tipo':'bebida','nome':'Cancelado','cancelado':True,'preco_total':99},
    {'tipo':'bebida','nome':'Água','qty':2,'preco_total':14,'pago':True}], 'total':0,'servico':False}
  blocos=mod.salao_consumo_blocos(p)
  self.assertIn(('produto','PAGO · 2x Água'),blocos)
  self.assertIn(('valor','R$ 14,00'),blocos)
  self.assertNotIn('Cancelado',str(blocos))
  self.assertIn(('total','A PAGAR: R$ 0,00'),blocos)
 def test_nome_sem_espacos_nao_vaza_da_largura(self):
  p={**PEDIDO,'itens':[{'tipo':'bebida','nome':'ProdutoMuitoLongo'*20,'qty':1,'preco_total':10}]}
  img=mod.salao_resumo_img(p)
  self.assertLessEqual(ImageChops.invert(img.convert('L')).getbbox()[2],561)

if __name__=='__main__': unittest.main()
