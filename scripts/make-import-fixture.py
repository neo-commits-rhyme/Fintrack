#!/usr/bin/env python3
"""Writes fixtures/bank-statement-sample.xlsx: a synthetic bank export in the exact
layout of the user's card statement (same sheet, headers, tab-padded cells, multi-line
recipient cells, sparse rows). Names and card numbers are fake."""
import zipfile, pathlib, html

HEAD = ["Дата платежа", "Время платежа", "Тип операции", "Имя поставщика", "Название организации поставщика",
        "Сумма платежа", "Категория", "Получатель / Отправитель", "Реквизиты платежа", "Номер карты",
        "Название карты", "Комментарий к платежу", "Тип чека", "Состояние чека", "Пункт обслуживания", "Терминал"]
C = "561468******1111"
# date, time, op, merchant, org, amount, bankcat, party, details, comment, receipt, state, point, terminal
ROWS = [
  ["07-11-2026", "22:23:59", "Списание", "OOO BEST COFFEE CHAIN", "OOO BEST COFFEE CHAIN", "35000", "общепит", "", "", "Покупка на POS-терминале", "Внешний", "Оплачен", "105746924\t", "50420\t"],
  ["07-11-2026", "20:48:45", "Списание", "OOO YANDEXGO UB", "OOO YANDEXGO UB", "133500", "такси", "", "", "Оплата через интернет", "Внешний", "Оплачен", "9801981839\t", "92300383\t"],
  ["07-11-2026", "17:23:00", "Поступление", "Перевод на карту", "Перевод на карту", "5000", "перевод", "", "", "Перевод средств с карты", "Внешний", "Оплачен", "105756508\t", "92805296\t"],
  ["07-11-2026", "16:07:14", "Поступление", "METRO DRUJBA UZKARD", "METRO DRUJBA UZKARD", "8000000", "наличные", "", "", "Пополнение наличными", "Внешний", "Оплачен", "90140043940\t", "59553\t"],
  ["07-11-2026", "11:37:03", "Списание", "Перевод с карты", "Перевод с карты", "1800000", "перевод", "", "", "Оплата услуг на терминалах, инфокиосках и банкоматах", "Внешний", "Оплачен", "90640007085\t", "92322568\t"],
  ["07-11-2026", "11:06:34", "Списание", "KORZINKA", "ИП ООО «ANGLESEY FOOD»", "55770", "продукты", "", "ID маркета:\n D003\t", "", "Payme", "Оплачен", "906292\t", "96300282\t"],
  ["07-11-2026", "09:15:54", "Списание", "OOO ATTO TOLOV", "OOO ATTO TOLOV", "2500", "транспорт", "", "", "Покупка на POS-терминале", "Внешний", "Оплачен", "903120543\t", "97006609\t"],
  ["06-11-2026", "22:06:40", "Списание", "Testova A.", "Testova A.", "4500000", "перевод", "Получатель:\n Testova A.\t", "Карта получателя:\n 561468******2222\t", "", "Payme", "Оплачен", "906258\t", "96300250\t"],
  ["06-11-2026", "21:27:47", "Списание", "ANGLESEY FOOD", "ANGLESEY FOOD", "101977", "магазин", "", "", "Покупка на POS-терминале", "Внешний", "Оплачен", "903400000000276\t", "93600960\t"],
  ["05-11-2026", "13:41:09", "Списание", "XK IMZO PRINT MEDIA GROUP", "XK IMZO PRINT MEDIA GROUP", "56000", "для дома", "", "", "Покупка на POS-терминале", "Внешний", "Оплачен", "90330147888\t", "33196720\t"],
  ["04-11-2026", "13:19:50", "Списание", "EDEN SEUL MCHJ XK", "EDEN SEUL MCHJ XK", "225000", "прочее", "", "", "Покупка на POS-терминале", "Внешний", "Оплачен", "90490044549\t", "64977\t"],
  ["03-11-2026", "15:03:25", "Списание", "IP OOO YANDEX EATS", "IP OOO YANDEX EATS", "85990", "прочее", "", "", "Оплата через интернет", "Внешний", "Оплачен", "9801981799\t", "92300350\t"],
  ["02-11-2026", "20:29:59", "Списание", "Empire Gaming", "ЧП «TESTOV KAMRON»", "75000", "игры", "", "", "", "Payme", "Оплачен", "906292\t", "96300282\t"],
  ["02-11-2026", "14:32:54", "Списание", "Payme Plus | Всё включено", "АО 'PAYME'", "39990", "услуги", "", "Пользователь:\n 6216f788fb19f117431c442c\t", "Оплата услуги 'Payme-Plus-Inclusive'", "Payme", "Оплачен", "906292\t", "96300282\t"],
  ["01-11-2026", "15:44:20", "Списание", "IP OOO YANDEXGO EATS", "IP OOO YANDEXGO EATS", "25500", "общепит", "", "", "Оплата через интернет", "Внешний", "Оплачен", "9801981841\t", "92300385\t"],
  ["01-11-2026", "12:00:00", "Списание", "OOO SOME SHOP", "OOO SOME SHOP", "99000", "прочее", "", "", "Покупка на POS-терминале", "Внешний", "Отменен", "1\t", "2\t"],
  ["01-11-2026", "11:21:51", "Поступление", "Testov B.", "Testov B.", "16500", "перевод", "Отправитель:\n Testov B.\t", "Карта отправителя:\n 561468*******333\t", "", "Payme", "Оплачен", "90330039338\t", "96044230"],
]

def col(i):
    return chr(ord('A') + i)

strings, index = [], {}
def sidx(s):
    if s not in index:
        index[s] = len(strings); strings.append(s)
    return index[s]

def row_xml(r, values, inline_at=None):
    cells = []
    for i, v in enumerate(values):
        if v == "":
            continue  # sparse: empty cells are omitted, like the real export
        ref = f"{col(i)}{r}"
        if i == 5:  # amount as a number
            cells.append(f'<c r="{ref}"><v>{v}</v></c>')
        elif inline_at == i:
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{html.escape(v)}</t></is></c>')
        else:
            cells.append(f'<c r="{ref}" t="s"><v>{sidx(v)}</v></c>')
    return f'<row r="{r}">{"".join(cells)}</row>'

rows = [row_xml(1, HEAD)]
for n, r in enumerate(ROWS, start=2):
    d, t, op, merch, org, amt, cat, party, det, com, rec, st, pt, term = r
    vals = [d, t, op, merch, org, amt, cat, party, det, C, "Ye", com, rec, st, pt, term]
    rows.append(row_xml(n, vals, inline_at=3 if n == 3 else None))

sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
         '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
         + "".join(rows) + '</sheetData></worksheet>')
sst = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(strings)}" uniqueCount="{len(strings)}">'
       + "".join(f'<si><t xml:space="preserve">{html.escape(s)}</t></si>' for s in strings) + '</sst>')
workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Filtered_Cheques" sheetId="1" r:id="rId1"/></sheets></workbook>')
ctypes = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="xml" ContentType="application/xml"/></Types>')

out = pathlib.Path(__file__).resolve().parent.parent / "fixtures" / "bank-statement-sample.xlsx"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", ctypes)
    z.writestr("xl/workbook.xml", workbook)
    z.writestr("xl/sharedStrings.xml", sst)
    z.writestr("xl/worksheets/sheet1.xml", sheet)
print("wrote", out)
