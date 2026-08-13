/**
 * Myth Studios event till — live sheet receiver.
 *
 * Paste this into Extensions → Apps Script on a fresh Google Sheet, then
 * Deploy → New deployment → Web app, "Execute as: Me", "Who has access:
 * Anyone". Copy the /exec URL into the till (Summary → Connect live sheet).
 *
 * The phone sends its FULL list of sales every time, so the sheet always
 * matches the phone exactly — deletes and undos included. Rows are replaced
 * per device, so two phones never overwrite each other.
 */

var ROWS = "Sales";
var SUM = "Summary";
var HEADERS = [
  "Time", "Customer", "Item", "List AED", "Paid AED",
  "Discount AED", "Payment", "Seller", "Device", "Sale ID"
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json({ ok: false, error: "busy" });
  }

  try {
    var body = JSON.parse(e.postData.contents);
    if (!body || !body.device) return json({ ok: false, error: "no device" });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(ROWS) || ss.insertSheet(ROWS);

    // Everything currently in the sheet, minus this device's rows —
    // this device is about to restate all of its own.
    var kept = [];
    if (sheet.getLastRow() > 1) {
      var old = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
      for (var i = 0; i < old.length; i++) {
        if (String(old[i][8]) !== String(body.device)) kept.push(old[i]);
      }
    }

    var incoming = (body.sales || []).map(function (s) {
      return [
        new Date(s.t),
        s.order || "",
        s.name || "",
        Number(s.list) || 0,
        Number(s.paid) || 0,
        Math.round(((Number(s.list) || 0) - (Number(s.paid) || 0)) * 100) / 100,
        s.method || "",
        body.seller || "",
        body.device,
        s.sid || ""
      ];
    });

    var all = kept.concat(incoming).sort(function (a, b) {
      return new Date(a[0]).getTime() - new Date(b[0]).getTime();
    });

    sheet.clear();
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight("bold").setBackground("#161314").setFontColor("#C9A24B");
    sheet.setFrozenRows(1);
    if (all.length) {
      sheet.getRange(2, 1, all.length, HEADERS.length).setValues(all);
      sheet.getRange(2, 1, all.length, 1).setNumberFormat("dd/MM HH:mm");
      sheet.getRange(2, 4, all.length, 3).setNumberFormat("#,##0.00");
    }
    sheet.autoResizeColumns(1, HEADERS.length);

    writeSummary(ss, all);
    return json({ ok: true, stored: incoming.length, total: all.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** A one-screen view for the owner's phone. Recomputed on every push. */
function writeSummary(ss, all) {
  var sheet = ss.getSheetByName(SUM) || ss.insertSheet(SUM, 0);
  var total = 0, cash = 0, card = 0;
  var orders = {}, items = {};

  for (var i = 0; i < all.length; i++) {
    var paid = Number(all[i][4]) || 0;
    total += paid;
    if (String(all[i][6]).toLowerCase() === "cash") cash += paid; else card += paid;
    orders[all[i][1]] = true;
    var name = all[i][2];
    if (!items[name]) items[name] = { q: 0, t: 0 };
    items[name].q++;
    items[name].t += paid;
  }

  var best = Object.keys(items).map(function (n) {
    return [n, items[n].q, items[n].t];
  }).sort(function (a, b) { return b[1] - a[1] || b[2] - a[2]; }).slice(0, 10);

  sheet.clear();
  var block = [
    ["MYTH STUDIOS — LIVE", ""],
    ["Updated", new Date()],
    ["", ""],
    ["Total taken", total],
    ["Cash", cash],
    ["Card", card],
    ["Figures sold", all.length],
    ["Customers", Object.keys(orders).length],
    ["", ""],
    ["BEST SELLERS", ""]
  ];
  sheet.getRange(1, 1, block.length, 2).setValues(block);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setFontSize(14)
    .setBackground("#161314").setFontColor("#C9A24B");
  sheet.getRange(2, 2).setNumberFormat("dd/MM/yyyy HH:mm:ss");
  sheet.getRange(4, 2, 5, 1).setNumberFormat("#,##0.00");
  sheet.getRange(4, 1, 1, 2).setFontWeight("bold").setFontSize(13);
  sheet.getRange(10, 1, 1, 2).setFontWeight("bold");

  if (best.length) {
    sheet.getRange(11, 1, best.length, 3)
      .setValues(best.map(function (b) { return [b[0], b[1] + "x", b[2]]; }));
    sheet.getRange(11, 3, best.length, 1).setNumberFormat("#,##0.00");
  }
  sheet.autoResizeColumns(1, 3);
}

/** Lets you confirm the deployment works by opening the /exec URL in a browser. */
function doGet() {
  return json({ ok: true, service: "Myth Studios till", ready: true });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
