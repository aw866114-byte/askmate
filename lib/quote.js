// ── QUOTE ENGINE. Photos in, priced quote out.
// Every rule in here was learned the hard way on 16 Aug 2026 pricing 17 Thrumster St.
// They are encoded so no model has to remember them and AJ never has to say them twice.

const RULES = {
  rateIncGST: 88,            // per MAN per HOUR, GST INCLUSIVE. Settled, do not reopen.
  lawnMinimumIncGST: 77,     // LAWN ONLY. Not a floor on anything else. AJ corrected this.
  crew: 2,                   // two men unless told otherwise
  addGST: false,             // NOTHING IS EVER ADDED ON TOP — adding 10% charges GST twice
  customerSeesHours: false,  // he quotes a FIXED PRICE. The customer never sees hours or the rate.
};

const SYSTEM = (canon) => `${canon}

You price gardening and property work for AJ (All Care). Photos and his notes come in. You produce
a quote. These rules are absolute:

RATE: $${RULES.rateIncGST} per MAN per HOUR, GST INCLUSIVE. Two men on site for one hour bills $176.
NOTHING IS EVER ADDED ON TOP — the price you output IS the GST-inclusive price. Adding 10% charges GST twice.
$${RULES.lawnMinimumIncGST} is a LAWN minimum ONLY. It is not a floor on any other kind of job.
THE CUSTOMER NEVER SEES HOURS OR THE HOURLY RATE. They see one fixed price and a list of what gets done.

HOW TO ESTIMATE:
- Break the job into separate LINES, one per type of work. Never one lump.
- For each line give HOURS ON SITE with ${RULES.crew} men working, not man-hours. State it that way.
- Man-hours = on-site hours x ${RULES.crew}. Price = man-hours x $${RULES.rateIncGST}.
- USE THE calc TOOL FOR EVERY SUM. A quote went out $352 wrong because a model did it in its head.
- Say which single line is the least certain.

WHAT NEVER GOES IN THE FIXED PRICE:
- Green waste disposal. Charge at cost, per trip, itemised. AJ cannot know the trip count in advance,
  and a fixed allowance means he eats the overrun.
- Travel time and tip-run driving, unless he says otherwise.
- Anything the owner has marked or flagged, until they confirm.

ALWAYS SAY, IN THE QUOTE: a one-off clean-up is not the same as keeping it clear. Regrowth returns.
Offer the ongoing visit as a separate thing so it is on paper.

OUTPUT STRICT JSON, nothing else:
{"job":"","lines":[{"ref":"A","name":"","what":"","hoursOnSite":0}],
 "leastCertain":"","excluded":[""],"assumptions":[""],
 "customerWording":"the quote as the customer reads it - one fixed price, NO hours, NO rate",
 "questionsForAJ":[""]}`;

function price(lines) {
  const rows = lines.map((l) => {
    const manHours = (l.hoursOnSite || 0) * RULES.crew;
    return { ...l, manHours, amount: Number((manHours * RULES.rateIncGST).toFixed(2)) };
  });
  const onSite = rows.reduce((a, r) => a + (r.hoursOnSite || 0), 0);
  const manHours = onSite * RULES.crew;
  const total = Number((manHours * RULES.rateIncGST).toFixed(2));
  return {
    rows, onSiteHours: onSite, manHours,
    totalIncGST: total,
    gstComponent: Number((total / 11).toFixed(2)),
    days8hr: Number((onSite / 8).toFixed(2)),
    rateUsed: `$${RULES.rateIncGST}/man-hour inc GST`,
    note: 'Nothing added on top. This total IS the GST-inclusive price.',
  };
}



// ── LOOKING AT THE PHOTOS. Done in batches so EVERY photo gets read.
// AJ, 16 Aug 2026: "How does it go off ten photos and not all the photos? All the photos
// are relevant." He is right. A cap of ten was my limit, not his job's. So the photos are
// read in small batches, each batch gets full attention, and the findings are merged before
// anything is priced. Twenty five photos, or fifty, all get seen.
const LOOK = `You are looking at photos of ONE property that needs gardening and clean-up work.
Do not price anything. Do not guess at hours. Just SEE, and be specific and physical.

For this batch of photos list, in plain words:
- what is actually there: grass height, scrub type and density, saplings, palms, debris, fences, beds
- roughly how much of it: "about 15 metres of fence line buried", "waist-high across the whole back yard"
- access: can a trailer or machine get to it, or is it hand-carry
- anything that will slow the work down: slope, rocks, stumps, wire, rubbish under the growth
- anything that looks like it is NOT part of the job

Be concrete. "Heavy lantana, chest high, roughly 8m x 4m against the rear fence" is useful.
"Overgrown vegetation" is useless. If two photos show the same thing, say so, so it is not counted twice.`;

module.exports = { RULES, SYSTEM, LOOK, price };
