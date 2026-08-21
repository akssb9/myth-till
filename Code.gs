/**
 * Myth Studios event till — live sheet receiver.
 *
 * Create a standalone project at script.google.com, paste this in, set SHEET_ID
 * to the spreadsheet you want it to write to, then
 * Deploy → New deployment → Web app, "Execute as: Me", "Who has access:
 * Anyone". Copy the /exec URL into the till (DEFAULT_SYNC_URL in index.html).
 *
 * The sheet is the permanent record, not the phone. Incoming sales are ADDED
 * and de-duplicated by Sale ID; rows are never removed just because a phone
 * stopped mentioning them. So a lost, broken, reset or storage-wiped phone
 * cannot delete the day's takings.
 *
 * Removing a sale is deliberately hard. A "void" from the phone is honoured only
 * within VOID_WINDOW_MS of the sheet RECEIVING that row — enough for Undo and an
 * immediate mis-ring, far too short to erase a day. Anything older can only be
 * removed by an owner request carrying ADMIN_KEY, which the phone never sends.
 *
 * That means a seller cannot wipe the takings, deliberately or by accident.
 *
 * Owner marks whose stock it was (Myth / Saeed) so the takings can be split.
 * Type marks whether it came off the grid or was typed in as a one-off.
 */

// The spreadsheet this deployment writes to. Set it and the script can live
// standalone — it does not need to be bound to the sheet. Leave it empty to
// fall back to the container the script is attached to.
var SHEET_ID = "1GBXTOUvLteXc8Rul2OsEqCfoIKkLj0TsIvRiTGTUpyw";   // Myth Studios — Jpex 20-23

var ROWS = "Sales";
var SUM = "Summary";
var HEADERS = [
  "Time", "Customer", "Item", "Owner", "Type", "List AED", "Paid AED",
  "Discount AED", "Payment", "Seller", "Device", "Sale ID", "Received"
];
var COL_PAID = 6;      // zero-based indexes into a row
var COL_PAYMENT = 8;
var COL_DEVICE = 10;
var COL_OWNER = 3;
var COL_ITEM = 2;
var COL_CUSTOMER = 1;
var COL_SALEID = 11;
var COL_RECEIVED = 12;          // server time the row landed — never the phone's clock

// A phone may cancel a sale only this soon after the sheet received it.
var VOID_WINDOW_MS = 5 * 60 * 1000;

// Owner-only override. Not in the app, not in the public page — see
// event-app/LIVE-SHEET-URLS.local.md. Lets Ahmed remove a row the app cannot.
var ADMIN_KEY = "SET-THIS-IN-THE-DEPLOYED-SCRIPT-ONLY";

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

    var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(ROWS) || ss.insertSheet(ROWS);

    // A void is a request, not a command. It is obeyed only for a row the sheet
    // received moments ago, or when the caller proves it is the owner.
    var isOwner = body.adminKey && body.adminKey === ADMIN_KEY;
    var now = Date.now();
    var asked = {};
    (body.voids || []).forEach(function (id) { asked[String(id)] = true; });
    var refused = 0;

    var kept = [], seen = {};
    if (sheet.getLastRow() > 1) {
      var old = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
      for (var i = 0; i < old.length; i++) {
        var sid = String(old[i][COL_SALEID]);
        if (asked[sid]) {
          var recv = old[i][COL_RECEIVED] ? new Date(old[i][COL_RECEIVED]).getTime() : 0;
          var fresh = recv && (now - recv) < VOID_WINDOW_MS;
          if (isOwner || fresh) continue;   // allowed to go
          refused++;                        // too old, and not the owner — it stays
        }
        seen[sid] = true;
        kept.push(old[i]);
      }
    }

    // Only sales the sheet has never seen. Re-sending the same list is harmless.
    var incomingNew = (body.sales || []).filter(function (s) {
      return s.sid && !seen[String(s.sid)];
    });

    var incoming = incomingNew.map(function (s) {
      var list = Number(s.list) || 0;
      var paid = Number(s.paid) || 0;
      return [
        new Date(s.t),
        s.order || "",
        s.name || "",
        s.owner || "Myth",
        s.custom ? "One-off" : "Catalogue",
        list,
        paid,
        Math.round((list - paid) * 100) / 100,
        s.method || "",
        body.seller || "",
        body.device,
        s.sid || "",
        new Date()
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
      // List / Paid / Discount are columns 6-8, 1-based (not COL_PAID, which indexes the array)
      sheet.getRange(2, 6, all.length, 3).setNumberFormat("#,##0.00");
    }
    sheet.autoResizeColumns(1, HEADERS.length);

    writeSummary(ss, all);
    return json({
      ok: true,
      added: incoming.length,
      removed: (body.voids || []).length - refused,
      refusedTooOld: refused,
      total: all.length
    });
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
  var owners = {};
  var orders = {}, items = {};

  for (var i = 0; i < all.length; i++) {
    var paid = Number(all[i][COL_PAID]) || 0;
    total += paid;
    if (String(all[i][COL_PAYMENT]).toLowerCase() === "cash") cash += paid; else card += paid;

    var who = all[i][COL_OWNER] || "Myth";
    if (!owners[who]) owners[who] = { total: 0, qty: 0 };
    owners[who].total += paid;
    owners[who].qty++;

    orders[all[i][COL_CUSTOMER]] = true;
    var name = all[i][COL_ITEM];
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
    ["WHOSE STOCK", ""]
  ];
  sheet.getRange(1, 1, block.length, 2).setValues(block);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setFontSize(14)
    .setBackground("#161314").setFontColor("#C9A24B");
  sheet.getRange(2, 2).setNumberFormat("dd/MM/yyyy HH:mm:ss");
  sheet.getRange(4, 2, 5, 1).setNumberFormat("#,##0.00");
  sheet.getRange(4, 1, 1, 2).setFontWeight("bold").setFontSize(13);
  sheet.getRange(10, 1, 1, 2).setFontWeight("bold");

  // Split by owner, so Saeed's share is a number you can read straight off.
  var names = Object.keys(owners).sort();
  var row = 11;
  if (names.length) {
    var split = names.map(function (n) {
      return [n, owners[n].total, owners[n].qty + " sold"];
    });
    sheet.getRange(row, 1, split.length, 3).setValues(split);
    sheet.getRange(row, 2, split.length, 1).setNumberFormat("#,##0.00");
    sheet.getRange(row, 1, split.length, 1).setFontWeight("bold");
    row += split.length;
  }

  row += 1;
  sheet.getRange(row, 1).setValue("BEST SELLERS").setFontWeight("bold");
  if (best.length) {
    sheet.getRange(row + 1, 1, best.length, 3)
      .setValues(best.map(function (b) { return [b[0], b[1] + "x", b[2]]; }));
    sheet.getRange(row + 1, 3, best.length, 1).setNumberFormat("#,##0.00");
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
