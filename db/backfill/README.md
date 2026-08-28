# Backfill de paciente_dependente

`backfill-paciente-dependente.js` popula `public.paciente_dependente` a partir
da listagem de pacientes exportada do Simples Dental (menores de 18).

O JSON de entrada (`minors-YYYY-MM-DD.json`) **não vai pro repo** (contém
CPF/telefone de menores). Pra regenerar a partir de uma exportação nova:

```
python -c "
import openpyxl, re, json
wb = openpyxl.load_workbook(r'CAMINHO/Listagem_pacientes...xlsx', data_only=True)
ws = wb.active
minors=[]
for nome,_,idade,doc,cel in list(ws.iter_rows(values_only=True))[1:]:
    if not idade: continue
    m=re.search(r'(\d+)',str(idade))
    if not m or int(m.group(1))>=18: continue
    minors.append({'nome':(nome or '').strip(),'anos':int(m.group(1)),
      'cpf':re.sub(r'\D','',str(doc)) if doc else None,
      'celular':re.sub(r'\D','',str(cel)) if cel else None})
json.dump({'minors':minors}, open('db/backfill/minors-DATA.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
"
node db/backfill/backfill-paciente-dependente.js --dry   # confere
node db/backfill/backfill-paciente-dependente.js         # aplica (idempotente)
```

Coluna `Celular` da planilha = WhatsApp da família/responsável do menor
(conferido: bate 100% com um `cliente` cadastrado). O nome do paciente é a
mesma string que aparece na agenda do SD, então casa com `consultas.paciente_nome`.
