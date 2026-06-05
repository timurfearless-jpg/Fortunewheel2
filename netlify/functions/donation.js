const {
  authorizedDonation,
  json,
  options,
  parseBody,
  parseDonation,
  rateLimited,
  runtimeConfig,
  triggerSpin
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options(event, "POST, OPTIONS");
  const limited = rateLimited(event, "donation", 40, 60 * 1000);
  if (limited) return limited;

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const body = parseBody(event);
  if (!authorizedDonation(event, body)) {
    return json(401, { ok: false, error: "Wrong or missing DONATION_SECRET" });
  }

  const { config } = await runtimeConfig();
  if (!config.donations || !config.donations.enabled) {
    return json(200, { ok: true, skipped: "Donations are disabled" });
  }

  const donation = parseDonation(body);
  const accepted = (config.donations.acceptedCurrencies || ["EUR"]).map((item) => String(item).toUpperCase());
  const threshold = Number(config.donations.minAmountEur || 5);

  if (!Number.isFinite(donation.amount)) {
    return json(400, { ok: false, error: "Could not read donation amount" });
  }

  if (!accepted.includes(donation.currency) || donation.amount < threshold) {
    return json(200, {
      ok: true,
      skipped: "Donation below threshold or unsupported currency",
      donation
    });
  }

  const spin = await triggerSpin({
    source: donation.source,
    name: donation.name,
    reason: `Donation ${donation.amount} ${donation.currency}`,
    amount: donation.amount,
    currency: donation.currency
  });

  return json(200, { ok: true, event: spin });
};
