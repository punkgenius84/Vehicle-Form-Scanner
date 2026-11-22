/* TowGuide vehicle database (US market, model-range level).
 *
 * Row format:
 *   [make, model, yearFrom, yearTo, body, drives, power, trans, curbLb, wheelbaseIn, groundClearanceIn, opts]
 *
 *   drives : "FWD|RWD|AWD|4WD"  (pipe separated; the user picks which one the vehicle has)
 *   power  : ICE | HEV | PHEV | EV
 *   trans  : AT | CVT | MT | DCT | EV (pipe separated)
 *   opts   : { gvwr, dually, air (true or 'opt'), low, note, c:0 }
 *            c:0 means "lower confidence estimate". Shown to the driver as a warning.
 *
 * Values are typical for the model range and are approximate. Ground clearance changes with
 * trim, tires, load and modifications. ALWAYS measure on scene and confirm in the owner's manual.
 * To add a vehicle, append a row to ROWS. tests/ will fail if a row is malformed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TowData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROWS = [
    // ---------- Ford ----------
    ['Ford', 'F-150', 2015, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 5000, 145.0, 8.4, { gvwr: 7000 }],
    ['Ford', 'F-150 Lightning', 2022, 2025, 'Pickup', 'AWD', 'EV', 'EV', 6500, 145.5, 8.9, { gvwr: 8250, c: 0 }],
    ['Ford', 'F-250 Super Duty', 2017, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 6800, 159.8, 8.4, { gvwr: 10000 }],
    ['Ford', 'F-350 Super Duty (single rear wheel)', 2017, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 7200, 159.8, 8.4, { gvwr: 11000 }],
    ['Ford', 'F-350 Super Duty (dually)', 2017, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 8300, 176.0, 8.4, { gvwr: 14000, dually: true }],
    ['Ford', 'F-450 Super Duty (dually)', 2017, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 8800, 176.0, 8.4, { gvwr: 14000, dually: true, c: 0 }],
    ['Ford', 'Ranger', 2019, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 4100, 126.8, 8.9, { c: 0 }],
    ['Ford', 'Maverick (Hybrid)', 2022, 2025, 'Pickup', 'FWD|AWD', 'HEV', 'CVT', 3600, 121.1, 5.9, { c: 0, note: 'The 2.0L gas model is a regular automatic; pick ICE-style rules only if you confirm it is not the hybrid.' }],
    ['Ford', 'Mustang', 2015, 2025, 'Coupe', 'RWD', 'ICE', 'AT|MT', 3700, 107.1, 4.9, { low: true }],
    ['Ford', 'Mustang Mach-E', 2021, 2025, 'SUV', 'RWD|AWD', 'EV', 'EV', 4400, 117.5, 5.7, { c: 0 }],
    ['Ford', 'Escape', 2020, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 3500, 106.7, 7.4, { c: 0 }],
    ['Ford', 'Escape Hybrid', 2020, 2025, 'SUV', 'FWD|AWD', 'HEV', 'CVT', 3700, 106.7, 7.4, { c: 0 }],
    ['Ford', 'Explorer', 2020, 2025, 'SUV', 'RWD|AWD', 'ICE', 'AT', 4500, 119.1, 7.9],
    ['Ford', 'Edge', 2015, 2024, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4000, 112.2, 7.4, { c: 0 }],
    ['Ford', 'Bronco', 2021, 2025, 'SUV', '4WD', 'ICE', 'AT|MT', 4700, 116.1, 8.3, { note: 'Clearance is higher with the larger off-road tires. Measure if modified.' }],
    ['Ford', 'Bronco Sport', 2021, 2025, 'SUV', 'AWD', 'ICE', 'AT', 3700, 105.1, 7.8, { c: 0 }],
    ['Ford', 'Expedition', 2018, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 5600, 122.5, 8.0, { c: 0, note: 'Expedition MAX has a 131.6 in wheelbase.' }],
    ['Ford', 'Transit', 2015, 2025, 'Van', 'RWD|AWD', 'ICE', 'AT', 5000, 148.0, 6.2, { gvwr: 9500, c: 0, note: 'Wheelbase is 130 or 148 in; the longer one is used here.' }],
    ['Ford', 'Fusion', 2013, 2020, 'Sedan', 'FWD|AWD', 'ICE', 'AT', 3500, 112.2, 5.2, { c: 0 }],
    ['Ford', 'Focus', 2012, 2018, 'Hatchback', 'FWD', 'ICE', 'AT|DCT|MT', 2950, 104.3, 5.0, { c: 0, note: '2012-2016 Focus with the PowerShift automatic is a dual-clutch: pick DCT.' }],

    // ---------- Chevrolet ----------
    ['Chevrolet', 'Silverado 1500', 2019, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 5000, 147.4, 8.1, { gvwr: 7200 }],
    ['Chevrolet', 'Silverado 2500HD', 2020, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 7100, 159.8, 8.4, { gvwr: 10000 }],
    ['Chevrolet', 'Silverado 3500HD (single rear wheel)', 2020, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 7300, 159.8, 8.4, { gvwr: 11500 }],
    ['Chevrolet', 'Silverado 3500HD (dually)', 2020, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 8200, 172.0, 8.4, { gvwr: 14000, dually: true }],
    ['Chevrolet', 'Colorado', 2015, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT|MT', 4200, 128.3, 8.3, { c: 0 }],
    ['Chevrolet', 'Equinox', 2018, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 3500, 108.3, 6.4, { c: 0 }],
    ['Chevrolet', 'Traverse', 2018, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4400, 120.9, 7.0, { c: 0 }],
    ['Chevrolet', 'Blazer', 2019, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4000, 112.7, 6.4, { c: 0 }],
    ['Chevrolet', 'Tahoe', 2021, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 5600, 120.9, 8.0, { c: 0 }],
    ['Chevrolet', 'Suburban', 2021, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 5800, 134.1, 8.0, { c: 0 }],
    ['Chevrolet', 'Malibu', 2016, 2024, 'Sedan', 'FWD', 'ICE', 'AT', 3200, 111.4, 5.1, { c: 0 }],
    ['Chevrolet', 'Camaro', 2016, 2024, 'Coupe', 'RWD', 'ICE', 'AT|MT', 3500, 110.7, 4.5, { low: true, c: 0 }],
    ['Chevrolet', 'Corvette (C7)', 2014, 2019, 'Coupe', 'RWD', 'ICE', 'AT|MT', 3300, 106.7, 4.2, { low: true, c: 0 }],
    ['Chevrolet', 'Corvette (C8)', 2020, 2025, 'Coupe', 'RWD', 'ICE', 'DCT', 3650, 107.2, 4.2, { low: true, c: 0, note: 'Mid-engine. Use the nose-lift system when loading if equipped.' }],
    ['Chevrolet', 'Bolt EV', 2017, 2023, 'Hatchback', 'FWD', 'EV', 'EV', 3600, 102.4, 5.1, { c: 0 }],
    ['Chevrolet', 'Express 2500', 2003, 2025, 'Van', 'RWD|AWD', 'ICE', 'AT', 5700, 135.0, 6.5, { gvwr: 8600, c: 0 }],

    // ---------- GMC ----------
    ['GMC', 'Sierra 1500', 2019, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 5000, 147.4, 8.1, { gvwr: 7200 }],
    ['GMC', 'Sierra 2500HD', 2020, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 7100, 159.8, 8.4, { gvwr: 10000 }],
    ['GMC', 'Sierra 3500HD (dually)', 2020, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 8200, 172.0, 8.4, { gvwr: 14000, dually: true }],
    ['GMC', 'Yukon', 2021, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 5600, 120.9, 8.0, { c: 0 }],
    ['GMC', 'Yukon XL', 2021, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 5800, 134.1, 8.0, { c: 0 }],
    ['GMC', 'Acadia', 2017, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4000, 112.5, 7.0, { c: 0 }],
    ['GMC', 'Hummer EV Pickup', 2022, 2025, 'Pickup', 'AWD', 'EV', 'EV', 9060, 129.7, 6.0, { gvwr: 10550, air: true, c: 0, note: 'Over 9,000 lb. Set air suspension to its highest setting before loading.' }],

    // ---------- Cadillac / Lincoln / Buick ----------
    ['Cadillac', 'Escalade', 2021, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 5800, 126.9, 8.0, { c: 0 }],
    ['Cadillac', 'CT5', 2020, 2025, 'Sedan', 'RWD|AWD', 'ICE', 'AT', 3900, 116.0, 5.0, { c: 0 }],
    ['Cadillac', 'Lyriq', 2023, 2025, 'SUV', 'RWD|AWD', 'EV', 'EV', 5600, 121.8, 6.0, { c: 0 }],
    ['Lincoln', 'Navigator', 2018, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 5800, 122.5, 8.0, { c: 0 }],
    ['Buick', 'Enclave', 2018, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4300, 120.9, 7.0, { c: 0 }],

    // ---------- Ram / Dodge / Chrysler / Jeep ----------
    ['Ram', '1500', 2019, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 5200, 144.5, 8.3, { gvwr: 7100, air: 'opt', c: 0 }],
    ['Ram', '2500', 2019, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 7000, 149.0, 8.0, { gvwr: 10000, c: 0 }],
    ['Ram', '3500 (single rear wheel)', 2019, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 7300, 169.5, 8.0, { gvwr: 11000, c: 0 }],
    ['Ram', '3500 (dually)', 2019, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 8200, 169.5, 8.0, { gvwr: 14000, dually: true, c: 0 }],
    ['Ram', 'ProMaster', 2014, 2025, 'Van', 'FWD', 'ICE', 'AT', 5100, 136.0, 6.0, { c: 0 }],
    ['Dodge', 'Charger', 2015, 2023, 'Sedan', 'RWD|AWD', 'ICE', 'AT', 4100, 120.2, 4.9, { low: true, c: 0 }],
    ['Dodge', 'Challenger', 2015, 2023, 'Coupe', 'RWD|AWD', 'ICE', 'AT|MT', 4100, 116.2, 4.9, { low: true, c: 0 }],
    ['Dodge', 'Durango', 2015, 2025, 'SUV', 'RWD|AWD', 'ICE', 'AT', 4700, 119.8, 8.1, { c: 0 }],
    ['Dodge', 'Grand Caravan', 2011, 2020, 'Minivan', 'FWD', 'ICE', 'AT', 4500, 121.2, 5.3, { c: 0 }],
    ['Chrysler', 'Pacifica', 2017, 2025, 'Minivan', 'FWD|AWD', 'ICE', 'AT', 4500, 121.6, 5.0, { c: 0 }],
    ['Chrysler', 'Pacifica Hybrid', 2017, 2025, 'Minivan', 'FWD', 'PHEV', 'CVT', 5100, 121.6, 5.0, { c: 0 }],
    ['Chrysler', '300', 2015, 2023, 'Sedan', 'RWD|AWD', 'ICE', 'AT', 4000, 120.2, 5.1, { c: 0 }],
    ['Jeep', 'Wrangler Unlimited (JL)', 2018, 2025, 'SUV', '4WD', 'ICE', 'AT|MT', 4300, 118.4, 9.7, { note: 'Part-time 4WD with a Neutral position on the transfer case: follow the owner\'s manual for any wheels-down towing.' }],
    ['Jeep', 'Wrangler Unlimited (JK)', 2007, 2018, 'SUV', '4WD', 'ICE', 'AT|MT', 4200, 116.0, 9.7, { c: 0 }],
    ['Jeep', 'Gladiator', 2020, 2025, 'Pickup', '4WD', 'ICE', 'AT|MT', 4650, 137.3, 10.9, { c: 0 }],
    ['Jeep', 'Grand Cherokee (WL)', 2022, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 4500, 116.7, 8.3, { air: 'opt', c: 0 }],
    ['Jeep', 'Grand Cherokee (WK2)', 2011, 2021, 'SUV', 'RWD|4WD', 'ICE', 'AT', 4600, 114.8, 8.1, { air: 'opt', c: 0 }],
    ['Jeep', 'Cherokee', 2014, 2023, 'SUV', 'FWD|4WD', 'ICE', 'AT', 3600, 106.5, 6.7, { c: 0 }],
    ['Jeep', 'Compass', 2017, 2025, 'SUV', 'FWD|4WD', 'ICE', 'AT', 3200, 103.8, 7.8, { c: 0 }],

    // ---------- Tesla / Rivian ----------
    ['Tesla', 'Model 3', 2017, 2025, 'Sedan', 'RWD|AWD', 'EV', 'EV', 4000, 113.2, 5.5],
    ['Tesla', 'Model Y', 2020, 2025, 'SUV', 'RWD|AWD', 'EV', 'EV', 4300, 113.8, 6.6],
    ['Tesla', 'Model S', 2012, 2025, 'Sedan', 'RWD|AWD', 'EV', 'EV', 4800, 116.5, 4.6, { air: true, c: 0 }],
    ['Tesla', 'Model X', 2016, 2025, 'SUV', 'AWD', 'EV', 'EV', 5200, 116.7, 5.2, { air: true, c: 0 }],
    ['Tesla', 'Cybertruck', 2024, 2025, 'Pickup', 'AWD', 'EV', 'EV', 6600, 143.1, 6.5, { air: true, c: 0, note: 'Adjustable ride height. Set it high before loading.' }],
    ['Rivian', 'R1T', 2022, 2025, 'Pickup', 'AWD', 'EV', 'EV', 7100, 135.8, 8.1, { air: true, c: 0, note: 'Adjustable ride height. Set it to the highest setting before loading.' }],

    // ---------- Toyota ----------
    ['Toyota', 'Camry', 2018, 2024, 'Sedan', 'FWD|AWD', 'ICE', 'AT', 3300, 111.2, 5.7],
    ['Toyota', 'Camry Hybrid', 2018, 2025, 'Sedan', 'FWD|AWD', 'HEV', 'CVT', 3500, 111.2, 5.7, { note: 'AWD hybrid is 2023 and newer.' }],
    ['Toyota', 'Corolla', 2019, 2025, 'Sedan', 'FWD', 'ICE', 'CVT|MT', 2900, 106.3, 5.1],
    ['Toyota', 'Prius', 2016, 2025, 'Hatchback', 'FWD|AWD', 'HEV', 'CVT', 3100, 108.3, 5.3],
    ['Toyota', 'RAV4', 2019, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 3500, 105.9, 8.4],
    ['Toyota', 'RAV4 Hybrid', 2019, 2025, 'SUV', 'AWD', 'HEV', 'CVT', 3700, 105.9, 8.1],
    ['Toyota', 'Highlander', 2020, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4300, 112.2, 8.0],
    ['Toyota', '4Runner', 2010, 2025, 'SUV', 'RWD|4WD', 'ICE', 'AT', 4400, 109.8, 9.6],
    ['Toyota', 'Tacoma', 2016, 2023, 'Pickup', 'RWD|4WD', 'ICE', 'AT|MT', 4100, 127.4, 9.4],
    ['Toyota', 'Tundra', 2022, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 5800, 145.7, 10.2, { gvwr: 7400 }],
    ['Toyota', 'Sienna', 2021, 2025, 'Minivan', 'FWD|AWD', 'HEV', 'CVT', 4600, 120.5, 6.5, { c: 0 }],

    // ---------- Honda ----------
    ['Honda', 'Civic', 2016, 2025, 'Sedan', 'FWD', 'ICE', 'CVT|MT', 2950, 107.7, 5.3],
    ['Honda', 'Accord', 2018, 2025, 'Sedan', 'FWD', 'ICE', 'CVT|AT|MT', 3300, 111.4, 5.3],
    ['Honda', 'Accord Hybrid', 2018, 2025, 'Sedan', 'FWD', 'HEV', 'CVT', 3400, 111.4, 5.0, { c: 0 }],
    ['Honda', 'CR-V', 2017, 2025, 'SUV', 'FWD|AWD', 'ICE', 'CVT', 3400, 104.7, 7.8],
    ['Honda', 'Pilot', 2016, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4300, 111.0, 7.3],
    ['Honda', 'Odyssey', 2018, 2025, 'Minivan', 'FWD', 'ICE', 'AT', 4400, 118.1, 5.9, { c: 0 }],
    ['Honda', 'Ridgeline', 2017, 2025, 'Pickup', 'AWD|FWD', 'ICE', 'AT', 4300, 125.2, 7.6, { note: 'FWD was only offered 2017-2019.' }],

    // ---------- Nissan ----------
    ['Nissan', 'Altima', 2019, 2025, 'Sedan', 'FWD|AWD', 'ICE', 'CVT', 3300, 111.2, 5.4, { c: 0 }],
    ['Nissan', 'Sentra', 2020, 2025, 'Sedan', 'FWD', 'ICE', 'CVT', 2900, 106.3, 5.5, { c: 0 }],
    ['Nissan', 'Rogue', 2021, 2025, 'SUV', 'FWD|AWD', 'ICE', 'CVT', 3500, 106.5, 8.2, { c: 0 }],
    ['Nissan', 'Pathfinder', 2022, 2025, 'SUV', 'FWD|AWD', 'ICE', 'AT', 4300, 114.2, 7.1, { c: 0 }],
    ['Nissan', 'Frontier', 2022, 2025, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 4400, 126.0, 9.2, { c: 0 }],
    ['Nissan', 'Titan', 2016, 2024, 'Pickup', 'RWD|4WD', 'ICE', 'AT', 5500, 139.8, 9.0, { c: 0 }],
    ['Nissan', 'Leaf', 2018, 2025, 'Hatchback', 'FWD', 'EV', 'EV', 3500, 106.3, 5.9, { c: 0 }],

    // ---------- Subaru ----------
    ['Subaru', 'Outback', 2020, 2025, 'SUV', 'AWD', 'ICE', 'CVT', 3700, 108.1, 8.7],
    ['Subaru', 'Forester', 2019, 2025, 'SUV', 'AWD', 'ICE', 'CVT', 3500, 105.1, 8.7],
    ['Subaru', 'Crosstrek', 2018, 2025, 'SUV', 'AWD', 'ICE', 'CVT|MT', 3200, 104.9, 8.7],
    ['Subaru', 'WRX', 2015, 2025, 'Sedan', 'AWD', 'ICE', 'MT|CVT', 3300, 104.9, 5.5, { c: 0 }]
  ];

  function toVehicle(r, i) {
    var o = r[11] || {};
    return {
      id: 'v' + i,
      make: r[0], model: r[1], yFrom: r[2], yTo: r[3], body: r[4],
      drives: r[5].split('|'), power: r[6], trans: r[7].split('|'),
      curb: r[8], wb: r[9], gc: r[10],
      gvwr: o.gvwr || 0, dually: !!o.dually, air: o.air || false,
      low: !!o.low, note: o.note || '', conf: o.c === 0 ? 0 : 1
    };
  }

  var vehicles = ROWS.map(toVehicle);
  var seen = {};
  var makes = vehicles.map(function (v) { return v.make; }).filter(function (m) {
    if (seen[m]) return false; seen[m] = true; return true;
  }).sort();

  return { ROWS: ROWS, vehicles: vehicles, makes: makes, toVehicle: toVehicle };
});
