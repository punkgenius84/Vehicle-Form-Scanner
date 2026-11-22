/* TowGuide rules engine.
 * Pure functions, no DOM. Works in the browser (window.TowEngine) and in Node (tests).
 *
 * What it answers for a given vehicle:
 *   1. HOW it should be towed        -> towMethod()
 *   2. WHICH class of truck is needed -> truckClass()
 *   3. WILL it clear a ramp/deck crest -> clearanceCheck()
 *
 * The rules encode common industry guidance. They are NOT a substitute for the
 * vehicle maker's towing instructions: always confirm against the owner's manual.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TowEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAFETY_MARGIN = 1.15;      // weight margin added when sizing the truck
  var LOW_CLEARANCE_IN = 5.5;    // below this we treat the car as "low"
  var DEG = Math.PI / 180;

  var ANGLE_PRESETS = [
    { id: 'standard', deg: 12, label: 'Standard rollback / deck-over (about 12°)' },
    { id: 'steep', deg: 15, label: 'Short bed / steep ramp (about 15°)' },
    { id: 'low', deg: 8, label: 'Low-angle or long bed (about 8°)' },
    { id: 'ext', deg: 6, label: 'Ramp extensions / blocks (about 6°)' }
  ];

  var BODY_PRESETS = {
    compact:  { label: 'Compact car',               curb: 2900, wb: 106, gc: 5.3 },
    sedan:    { label: 'Midsize / large sedan',     curb: 3400, wb: 111, gc: 5.5 },
    sports:   { label: 'Sports / muscle coupe',     curb: 3700, wb: 108, gc: 4.5 },
    crossover:{ label: 'Compact SUV / crossover',   curb: 3500, wb: 106, gc: 7.5 },
    suv:      { label: 'Midsize / full-size SUV',   curb: 4800, wb: 118, gc: 8.0 },
    minivan:  { label: 'Minivan',                   curb: 4500, wb: 121, gc: 5.3 },
    pickup:   { label: 'Half-ton pickup',           curb: 5000, wb: 145, gc: 8.3, gvwr: 7000 },
    hdpickup: { label: 'HD pickup (3/4 or 1 ton)',  curb: 7000, wb: 160, gc: 8.3, gvwr: 10000 },
    dually:   { label: 'Dually pickup',             curb: 8200, wb: 176, gc: 8.3, gvwr: 14000, dually: true },
    van:      { label: 'Full-size cargo van',       curb: 5500, wb: 135, gc: 6.5, gvwr: 9000 },
    evsedan:  { label: 'EV sedan / hatchback',      curb: 4000, wb: 113, gc: 5.5 }
  };

  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function posNum(x, d) { return (typeof x === 'number' && isFinite(x) && x > 0) ? x : d; }
  function has(arr, x) { return arr.indexOf(x) !== -1; }

  /* Merge a database vehicle with the user's selections/overrides into one flat record. */
  function resolve(v, sel) {
    sel = sel || {};
    var drives = (v.drives && v.drives.length) ? v.drives : ['FWD'];
    var trans = (v.trans && v.trans.length) ? v.trans : ['AT'];
    var gc = posNum(sel.gc, v.gc);
    var wb = posNum(sel.wb, v.wb);
    return {
      name: ((v.make || '') + ' ' + (v.model || '')).trim(),
      body: v.body || '',
      drive: has(drives, sel.drive) ? sel.drive : drives[0],
      trans: v.power === 'EV' ? 'EV' : (has(trans, sel.trans) ? sel.trans : trans[0]),
      power: v.power || 'ICE',
      curb: posNum(sel.curb, v.curb),
      gvwr: posNum(sel.gvwrOverride, v.gvwr || 0),
      wb: wb,
      gc: gc,
      measured: posNum(sel.gc, 0) > 0 || posNum(sel.wb, 0) > 0,
      dually: !!v.dually,
      air: v.air || false,
      low: !!v.low || gc < LOW_CLEARANCE_IN,
      conf: v.conf === 0 ? 0 : 1,
      note: v.note || '',
      extraLb: Math.max(0, +sel.extraLb || 0),
      angle: posNum(sel.angle, 12)
    };
  }

  /* ---------- 1. Tow method ---------- */
  function towMethod(n) {
    var m = {
      primary: 'Flatbed / rollback (all four wheels off the ground)',
      flatbedOnly: false,
      why: [],
      alternates: [],
      never: []
    };
    var lock = [];

    if (n.power === 'EV') {
      lock.push('Electric drive: wheels turning while towed can damage the motor and drive unit and can back-feed the high-voltage system.');
      m.never.push('Do not tow with any wheel on the ground (no wheel-lift, no sling) unless the maker\'s guide explicitly allows it.');
    }
    if (n.trans === 'DCT') {
      lock.push('Dual-clutch transmission: it is not lubricated with the engine off, so rolling the drive wheels can destroy it.');
      m.never.push('Do not tow the drive wheels on the ground.');
    }
    if (n.drive === 'AWD' || n.drive === '4WD') {
      lock.push((n.drive === 'AWD' ? 'All-wheel drive' : 'Four-wheel drive') +
        ' ties the front and rear axles together, so towing on one axle can wreck the center coupling, transfer case or differentials.');
      m.never.push('Do not tow with only one axle on the ground unless the owner\'s manual says that is allowed.');
    }

    if (lock.length) {
      m.flatbedOnly = true;
      m.why = lock;
      if (n.power === 'EV') {
        m.alternates.push('Put the vehicle in its Tow / Transport mode first (neutral, parking brake released). Check the maker\'s emergency-response guide.');
        m.alternates.push('No flatbed available: four wheels on dollies or skates, only if the manual lists it.');
      } else if (n.drive === 'AWD' || n.drive === '4WD') {
        m.alternates.push('Last resort: all four wheels off the ground (wheel-lift on one axle plus dollies or skates under the other).');
        if (n.drive === '4WD') {
          m.alternates.push('Some part-time 4WD trucks and SUVs can be towed with the transfer case in Neutral. Only do this if the owner\'s manual says so.');
        }
      }
    } else {
      if (n.power === 'HEV' || n.power === 'PHEV') {
        m.why.push('Hybrid: the electric motors turn with the drive wheels, so wheels-down towing can damage them. Flatbed is the safe default.');
      } else {
        m.why.push('A flatbed is always the safest way to move a car. Wheel-lift is acceptable for this drivetrain if you lift the DRIVE wheels.');
      }
      if (n.drive === 'FWD') {
        m.alternates.push('Wheel-lift under the FRONT (drive) tires with the rear wheels rolling. Unlock the steering and keep the rear wheels straight.');
        m.never.push('Do not lift the rear and roll the front (drive) wheels on the ground.');
      } else {
        m.alternates.push('Wheel-lift under the REAR (drive) tires with the front wheels rolling. Unlock the steering and secure the front wheels straight.');
        m.alternates.push('If the rear wheels must roll: remove the rear driveshaft (mark it first).');
        m.never.push('Do not tow a rear-drive automatic with the rear wheels rolling and the driveshaft still installed (beyond the manual\'s distance and speed limit).');
      }
      if (n.power === 'HEV' || n.power === 'PHEV') {
        m.alternates.push('Wheel-lift only if the owner\'s manual allows it, and lift the drive wheels.');
      }
    }
    return m;
  }

  /* ---------- 2. Truck class ---------- */
  function truckClass(n) {
    var weight = n.curb + n.extraLb;
    var required = Math.round(weight * SAFETY_MARGIN);
    var reasons = [fmt(weight) + ' lb vehicle weight + 15% margin = ' + fmt(required) + ' lb to be rated for.'];
    var rank = required <= 10000 ? 0 : (required <= 20000 ? 1 : 2);

    if (n.gvwr > 10000 && rank < 1) {
      rank = 1;
      reasons.push('GVWR is ' + fmt(n.gvwr) + ' lb (over 10,000), so use at least a medium-duty unit.');
    }
    if (n.gvwr > 26000 && rank < 2) {
      rank = 2;
      reasons.push('GVWR over 26,000 lb needs a heavy-duty unit.');
    }
    if (n.dually && rank < 1) {
      rank = 1;
      reasons.push('Dual rear wheels: use a medium-duty unit (wider, higher-rated equipment).');
    }

    var classes = [
      { id: 'light', label: 'Light-duty', detail: 'Standard car carrier / rollback or wheel-lift, rated for roughly up to 10,000 lb of vehicle.' },
      { id: 'medium', label: 'Medium-duty', detail: 'Larger flatbed or medium-duty wrecker, rated for roughly 10,000 to 20,000 lb of vehicle.' },
      { id: 'heavy', label: 'Heavy-duty', detail: 'Heavy wrecker or rotator, for vehicles over about 20,000 lb.' }
    ];
    var c = classes[rank];
    return {
      id: c.id, label: c.label, detail: c.detail,
      weightLb: weight, requiredLb: required, reasons: reasons,
      note: 'Always check the rating plate on the truck, not just its class.'
    };
  }

  /* ---------- 3. Clearance / breakover ----------
   * Model: a car with wheelbase W and belly clearance C crosses a crest where a ramp
   * meets a flat deck at angle d. Worst case the crest sits mid-wheelbase, so the
   * crest rises about (W/4)*sin(d) above the line between the wheel contact points.
   * The belly clears if C is greater than that.
   * This covers belly breakover only. Front lip, splitter, side skirts and rear
   * diffuser (approach/departure) still have to be checked by eye.
   */
  function clearanceCheck(n) {
    var need = (n.wb / 4) * Math.sin(n.angle * DEG);
    var maxAngle = Math.asin(Math.min(1, (4 * n.gc) / n.wb)) / DEG;
    var ratio = need > 0 ? n.gc / need : Infinity;
    var status = ratio >= 1.15 ? 'ok' : (ratio >= 0.9 ? 'marginal' : 'fail');
    var advice = [];

    if (status === 'ok') {
      advice.push('Should clear at ' + r1(n.angle) + '°. Still spot the belly and the front and rear lips while loading.');
    } else if (status === 'marginal') {
      advice.push('Tight at ' + r1(n.angle) + '°. Reduce the angle with ramp extensions or blocks, load slowly with a spotter, and consider go-jacks.');
    } else {
      advice.push('Likely to scrape or hang up at ' + r1(n.angle) + '°. This vehicle needs a crest angle of about ' + r1(maxAngle) + '° or less.');
      advice.push('Use a low-angle or long bed, ramp extensions plus wood or wedge blocks at the crest, or go-jacks / skates to raise the low end.');
    }
    if (n.low) {
      advice.push('Low car: protect the front lip and splitter with boards or a wedge, and check side skirts.');
    }
    if (n.measured) {
      advice.push('Using the clearance and wheelbase you entered.');
    } else if (n.conf === 0) {
      advice.push('Clearance for this model is an estimate. Measure the lowest point between the axles on level ground.');
    }
    return {
      gc: r1(n.gc), wb: r1(n.wb), angle: r1(n.angle),
      neededIn: r1(need), maxAngleDeg: r1(maxAngle),
      status: status, advice: advice
    };
  }

  /* ---------- warnings, equipment, checklist ---------- */
  function warningsFor(n, method) {
    var w = [];
    if (n.note) w.push(n.note);
    if (n.conf === 0) w.push('Specs for this model are estimates (lower confidence). Measure on scene before committing.');
    if (n.low && !method.flatbedOnly) {
      w.push('Low ground clearance: wheel-lift forks may not fit under the tires. Use wheel nets, dollies, or load on a flatbed.');
    }
    if (n.air === true) {
      w.push('Air suspension: set Tow / Transport mode or lock the ride height. The car can sink while parked and lose clearance.');
    } else if (n.air === 'opt') {
      w.push('If equipped with air suspension: set Tow / Transport mode or lock the ride height before loading.');
    }
    if (n.dually) {
      w.push('Dual rear wheels: use equipment rated for duals; tie-down points and strap length differ.');
    }
    if (n.curb >= 8000) {
      w.push('Heavy vehicle: confirm deck rating, winch line pull and chain rating before the pull.');
    }
    if (n.power === 'EV' || n.power === 'PHEV' || n.power === 'HEV') {
      w.push('If crash-damaged, treat the high-voltage battery as a fire risk: do not stack it with other vehicles and tell the yard.');
    }
    return w;
  }

  function equipmentFor(n, method, clr, truck) {
    var e = ['Flatbed / rollback with a working winch, plus four tie-downs (ratchet straps or chains with wheel nets).'];
    if (clr.status !== 'ok' || n.low) e.push('Ramp extensions, wood or wedge blocks, and go-jacks.');
    e.push('Wheel dollies or skates (locked wheels, no key, no power, damaged drivetrain).');
    e.push('Wheel nets or straps for alloy and low-profile wheels (avoid J-hooks on them).');
    if (n.dually) e.push('Long chains and tie-downs rated for dual rear wheels.');
    if (truck.id !== 'light') e.push('Confirm the unit\'s plated rating: ' + fmt(truck.requiredLb) + ' lb or more.');
    if (!method.flatbedOnly) e.push('Wheel-lift (only if no flatbed): rated for the vehicle weight.');
    e.push('Gloves, flashlight, wheel chocks.');
    return e;
  }

  function checklistFor(n, method) {
    var s = [
      'Confirm the drivetrain (AWD/4WD, hybrid, EV, dual-clutch) from the VIN, badges and the owner\'s manual before choosing the method.',
      'Look up the maker\'s tow instructions (owner\'s manual "Emergency towing") for the neutral and Tow / Transport mode procedure.',
      'Release the parking brake (electric parking brakes: use the manual\'s override) and put the vehicle in Neutral / Tow mode.',
      'Unlock the steering. If wheels will roll, secure the steering straight.',
      'Strap to the maker\'s tie-down points or through the wheels with nets. Never to suspension arms or thin bumper brackets.',
      'Spot the belly, front lip and rear bumper while loading. Stop and add blocks if anything touches.',
      'Re-check straps, chains and lights after the first mile.'
    ];
    if (!method.flatbedOnly) {
      s.splice(5, 0, n.drive === 'FWD'
        ? 'Wheel-lift: lift the FRONT (drive) axle only.'
        : 'Wheel-lift: lift the REAR (drive) axle only, or remove the rear driveshaft if the rear must roll.');
    }
    return s;
  }

  /* ---------- tie-down & loading procedure ----------
   * Step-by-step so a first-timer can follow it. Numbers (tie-down count and
   * working load limits) are sized from the vehicle weight.
   * Federal cargo rule used: aggregate working load limit of all tie-downs must be
   * at least 50% of the cargo weight. We recommend 100%.
   */
  function tiedownPlan(n, method, truck, clr) {
    var weight = n.curb + n.extraLb;
    var count = (weight >= 10000 || n.wb >= 150) ? 6 : 4;
    var legalAgg = Math.ceil((weight * 0.5) / 10) * 10;
    var recAgg = Math.ceil(weight / 10) * 10;
    var per = Math.ceil((weight / count) / 100) * 100;
    var gear;
    if (per <= 3300) gear = "2-inch ratchet straps (typically 3,333 lb working load limit each) or 5/16 in grade 70 transport chain (4,700 lb)";
    else if (per <= 4700) gear = "5/16 in grade 70 transport chain (4,700 lb each) with ratchet or lever binders";
    else if (per <= 6600) gear = "3/8 in grade 70 transport chain (6,600 lb each) with rated binders";
    else gear = "heavier chain and binders rated at " + fmt(per) + " lb or more each (use the equipment on a medium or heavy unit)";

    var isTruckLike = /pickup|van/i.test(n.body) || n.dually;
    var isEV = n.power === 'EV';
    var methodAdvice = [];
    methodAdvice.push("Method 1 (best): hook straps or chains to the maker's tie-down points shown in the owner's manual (slots or loops under the bumpers, or frame loops on trucks).");
    methodAdvice.push("Method 2: wheel nets or lasso straps over the tops of the tires. Best for alloy or low-profile wheels, and when there are no tie-down points. Uses 4 nets, one per tire.");
    if (isTruckLike) methodAdvice.push("Method 3 (trucks and vans): chain or axle strap around a solid frame rail or axle tube, with a soft loop or rubber pad so the finish and brake lines are protected.");
    if (isEV) methodAdvice.push("EV: use only the maker's designated points or wheel nets. Never hook, lift or strap to the underbody; the battery pack and high-voltage cables are there.");

    var steps = {};

    steps.before = [
      "Park the truck on level, firm ground, out of traffic. Hazard lights on, cones or flares out per your company rules. Set the truck's parking brake, and chock its wheels if there is any slope.",
      "Walk around the vehicle and take photos of all four corners and all four wheels. Write down any damage, missing parts, and low or flat tires.",
      "Check the vehicle is safe to move: no fuel or fluid leaking, no hanging bumper or panels. Remove loose items from the roof and outside.",
      "Find the maker's tie-down and tow points in the owner's manual (\"Emergency towing\" or \"Transporting\" page). Typical spots: slots or hooks under the front and rear bumpers, a screw-in tow eye kept in the trunk tool kit, or frame loops on trucks.",
      "Check that the wheels roll: not seized, steering not jammed. If any wheel is locked or the car will not roll, plan on skates or dollies under that wheel."
    ];
    if (n.air) steps.before.push("Air suspension: set Tow / Transport mode, or lock the ride height, before loading.");
    if (isEV) steps.before.push("EV: switch on Tow / Transport mode (neutral with the parking brake released) as described in the maker's emergency-response guide. Keep the vehicle's wheels off the ground entirely for the trip.");

    steps.prepare = [
      "If you have the key: ignition ON or ACC so the steering unlocks. Press the brake while shifting.",
      "While winching the car onto the deck it has to roll: Neutral, parking brake OFF, steering straight.",
      "Fold in the mirrors, close windows and sunroof, turn off any auto-start or auto-parking-brake features (see manual).",
      "Remove any hitch ball or ball mount that hangs below the bumper, or any aftermarket parts that could drag."
    ];

    steps.setup = [
      "Truck parking brake on. Engage the PTO / hydraulics as the unit's manual says.",
      "Slide the bed back and tilt it down to the ground. Aim for a crest angle of " + clr.maxAngleDeg + " degrees or less for this vehicle (you are set at " + clr.angle + " degrees; clearance check is " + clr.status.toUpperCase() + ").",
      "Sweep the deck and ramp: no oil, ice, mud or debris.",
      "Inspect the winch cable and hook: no kinks or broken strands, hook latch works. Pull out enough cable to reach the vehicle and keep at least 5 full wraps on the drum."
    ];
    if (clr.status !== 'ok' || n.low) {
      steps.setup.splice(2, 0, "Place ramp extensions or wood blocks where the ramp meets the ground and at the crest to lower the angle. Put a board or wedge under the front lip of a low car.");
    }

    steps.load = [
      "Put one spotter to the side where they can see the belly and both tires. Everyone else stays out of the line of the winch cable.",
      "Attach the winch hook to the maker's tow eye or recovery point on the end going on first (usually the front). Never hook to a bumper cover, suspension arm, tie rod or exhaust. If there is no eye, use a chain or strap around the frame or solid axle point shown in the manual.",
      "Close the hook latch. Check the cable is straight with no twists.",
      "Winch at slow speed. Stop at the crest and look at the belly. If anything touches, stop, add blocks or use go-jacks, and try again.",
      "Pull the vehicle forward until its tires are about a hand-width from the headache rack (the frame behind the cab). Its weight should sit ahead of the truck's rear axle; never let most of the weight hang behind the rear axle, because it takes weight off the steering axle.",
      "Once in position: automatic into Park, manual into first gear or reverse, parking brake ON. Exception: if the maker requires Neutral (EV Tow mode, some AWD), follow that and rely on the tie-downs."
    ];

    steps.tiedown = [
      "You need at least " + count + " independent tie-downs: one at each corner" + (count > 4 ? ", plus a middle pair for this long or heavy vehicle" : "") + ". The winch cable does NOT count as a tie-down.",
      "Rating: at least 50% of the vehicle weight (" + fmt(legalAgg) + " lb) across all tie-downs together is the federal minimum. We recommend 100% (" + fmt(recAgg) + " lb), which is at least " + fmt(per) + " lb working load limit each with " + count + " tie-downs. Suggested gear: " + gear + ". Read the working load limit tag; do not use any strap or chain without one.",
      "Front pair: attach to the two front tie-down points (or net the front tires). Run each strap forward and slightly outward to anchor points on the deck ahead of the car.",
      "Rear pair: attach to the two rear tie-down points (or net the rear tires). Run each strap backward and slightly outward to anchor points behind the car. Front and rear straps pull in opposite directions so the car cannot slide.",
      "Angle: aim for about 45 degrees between the strap and the deck. Below about 30 degrees the strap cannot hold the car down; above about 60 degrees it cannot hold it from sliding.",
      "Route straps away from exhaust, brake lines, rotors and sharp edges. Put edge protectors or sleeves on any edge a strap rubs.",
      "Take up the slack and ratchet until firm. For wheel nets, tighten until the car just settles on its suspension. Do not crank until body panels or the suspension bottom out.",
      "No twists in flat straps. No knots in straps or chains. Hooks fully seated, binders locked, ratchets folded flat, and loose tails tied off so they cannot flap.",
      "Push test: shove each corner of the car. It must not shift or bounce. Re-tighten anything loose.",
      "Spool the winch slack out, stow the hook, and secure it so it cannot swing."
    ];

    steps.final = [
      "Stow ramp extensions, lock the bed, and put away the controls per the unit's manual.",
      "Check overall height: most states allow 13 ft 6 in. Measure tall vehicles such as lifted trucks or roof racks. Check your state's limit.",
      "Walk around once more: all tie-downs tight, nothing hanging, tow-truck lights and marker lights working, license plate visible.",
      "Keep the key and paperwork with the driver."
    ];

    steps.road = [
      "Re-check straps and chains after the first mile (stop in a safe place and re-tighten).",
      "Re-check again within the first 50 miles, then every 3 hours or 150 miles, whichever comes first.",
      "Take corners and ramps slowly, and leave extra stopping distance; this load is heavy and high."
    ];

    steps.unload = [
      "Park on level ground. Truck parking brake ON, chock the truck wheels.",
      "Remove tie-downs in reverse order (rear pair, then front). Keep the winch cable hooked and slightly tight while you do.",
      "Slide and tilt the bed. Put the vehicle in Neutral, parking brake OFF, steering straight.",
      "Spotter at the side. Lower the car using the winch to control it; never let it free-roll.",
      "When the tires are on the ground: Park (or gear), parking brake ON, chock a wheel, unhook the cable, and take photos of the vehicle as it was delivered."
    ];

    var wheelLift = null;
    if (!method.flatbedOnly) {
      var lifted = n.drive === 'FWD' ? 'FRONT' : 'REAR';
      var rolling = n.drive === 'FWD' ? 'REAR' : 'FRONT';
      wheelLift = [
        "Use only if no flatbed. Lift the " + lifted + " (drive) tires; the " + rolling + " tires roll.",
        "Back the truck square to the vehicle. Check the " + lifted.toLowerCase() + " tires have room for the forks (low cars may not).",
        "Place the wheel-lift forks or cradle against the tires (never against the bumper or body). Use wheel nets or straps on alloy or low-profile wheels, not J-hooks.",
        "Raise the " + lifted.toLowerCase() + " tires about 6 inches off the ground, adjusting for road dips.",
        "Fit safety chains or straps in an X from the lift to the maker's tie-down points or the frame. Keep them snug, not tight, and clear of brake lines.",
        "Unlock the steering and strap the " + rolling.toLowerCase() + " wheels straight (steering wheel clamp or strap). If you cannot unlock the steering, use dollies instead.",
        "Parking brake OFF and Neutral. Connect tow lights and check turn signals and brake lights.",
        n.drive === 'FWD'
          ? "Follow the manual's distance and speed limit. Drive slowly and avoid hard braking."
          : "If the rear tires must roll, remove the rear driveshaft first. Follow the manual's distance and speed limit."
      ];
    }

    var dollies = [
      "Use when a wheel is locked or seized, there is no key or power, or when the maker allows four-wheel dollies. Never use dollies on a vehicle where the manual forbids them.",
      "Skates and go-jacks: put the skate beside the tire, slide the rollers under the tire, pump the jack until the tire is clear, then lower it into the cradle. Do each locked wheel.",
      "Dollies: roll the tire onto the dolly (or jack it up and set it on), strap the tire to the dolly with the ratchet strap, and make sure the dolly's safety pin or latch is engaged.",
      "Load onto the flatbed with the winch exactly as in the loading steps. Dolly wheels must roll straight."
    ];

    var operator = [
      "A commercial driver's license (CDL) is required to operate a truck with a GVWR or GCWR of 26,001 lb or more. Check the truck's rating plate (door jamb). 26,001 lb or more means CDL; a combination that tows a unit over 10,000 lb is Class A.",
      "Add the air brake endorsement if the truck has air brakes.",
      "Many light-duty rollbacks are under 26,001 lb and do not need a CDL, but state rules, DOT numbers, insurance and medical-card rules vary. Confirm with your state's DMV and DOT. This is general information, not legal advice."
    ];

    var glossary = [
      ["WLL", "Working load limit: the most load a strap, chain or hook is rated to carry in service. Printed on the tag."],
      ["Headache rack", "The frame behind the cab that protects it from sliding cargo."],
      ["Crest", "The point where the ramp meets the flat deck."],
      ["Wheel net / lasso strap", "A strap that goes over the top of a tire to hold the car down without touching the wheel."],
      ["Go-jack / skate", "A small wheeled jack that lifts a locked tire so the car can still roll."],
      ["Tie-down points", "Slots or loops the maker built in to strap or hook to. Listed in the owner's manual."]
    ];

    /* Hands-on technique cards. Written for someone who has never done it. */
    var corners = [
      ["Front left", "Hook or net at the front-left point. Run the strap forward and outward (toward the front-left corner of the deck), about 45 degrees from the deck. Anchor to a deck D-ring or stake pocket that is ahead of the vehicle's front-left tire."],
      ["Front right", "Same as front left, mirrored. Run it forward and outward to the front-right deck anchor. Both front straps should be the same length and the same tightness."],
      ["Rear left", "Hook or net at the rear-left point. Run the strap backward and outward to a deck anchor behind the vehicle's rear-left tire. This strap pulls the opposite way from the fronts, so the car is held from sliding in both directions."],
      ["Rear right", "Same as rear left, mirrored. Tighten the rears to the same firmness as the fronts."]
    ];
    if (count > 4) {
      corners.push(["Middle pair (6-point loads)", "Heavy or long vehicle: add two more tie-downs at the frame or axle midpoint, one per side, run straight out sideways or slightly forward. They stop the load from swaying and share the weight."]);
    }

    var techniques = {
      corners: corners,
      wheelNets: [
        "Use one net per tire (4 total). Check the net's tag for a working load limit that covers your per-tie-down number above.",
        "Lay the net over the top of the tire, with the net's strap sitting on the tread. The net's cross-strap should rest on the middle of the tread, not on the wheel face or the alloy.",
        "Pull the net's side hooks (or loops) down both sides of the tire and hook them to deck anchors through the straps. Keep the net's hook ends outside the sidewalls; they must not rub the wheel or touch brake parts.",
        "Install all four nets, then ratchet each one slowly, a few clicks at a time, rotating front-left, rear-right, front-right, rear-left so the car does not get pulled to one side.",
        "Stop when the net is firm and the vehicle's suspension has settled about an inch. Over-tightening bottoms the suspension and can crack a tire sidewall.",
        "Advantage: nothing touches the car body or suspension. Best for alloy wheels, low cars and EVs."
      ],
      straps: [
        "Inspect before every use: no cuts, burns, fraying, melted spots, chemical stains, or knots. Check the stitching on the loops and the working load limit tag. If the tag is missing or unreadable, do not use it.",
        "Feed the loose end of the strap through the ratchet's axle slot from the BOTTOM, leaving about 6 inches sticking through.",
        "Pull the loose end until most of the slack is gone, with the strap flat and untwisted.",
        "Ratchet: pump the handle with short strokes. Each click gives about half an inch of tension. Stop once the strap is firm. Two or three wraps on the spool is normal; do not wrap more than about 4.",
        "Close the ratchet handle fully until it locks flat. A ratchet left open can release.",
        "Tie off the tail: wrap loose webbing with a half hitch or use a strap keeper so it cannot flap in the wind or hit the vehicle.",
        "Protect edges: slide a sleeve or corner guard over any sharp edge the strap crosses, and never let it touch the exhaust or a hot brake rotor."
      ],
      chains: [
        "Use grade 70 transport chain only (stamped with a 7 or 70 on the links). Never use hardware-store chain or lifting chain. Check the working load limit tag against the number above.",
        "Look at every link: no stretch, cracks, nicks, or bent links. If you see any, take it out of service.",
        "Hook the chain to the maker's point, a frame rail or the axle tube. Use a soft loop or rubber sleeve where it touches painted or finished surfaces.",
        "Hook the other end into the deck anchor. Remove slack with the load binder. Pull toward the rear of the truck for rear tie-downs, forward for front.",
        "Use a ratchet binder or lever binder: open the handle, hook the ends, close the handle fully. A lever binder should take real effort to close. If it snaps shut with no effort, there is too much slack: take up more by hand and try again.",
        "Secure the binder handle: tie or clip it so it cannot fall open on the road. Never hit a binder with a hammer or use a cheater pipe."
      ],
      inspect: [
        "Straps and chains: discard if cut, burned, frayed, stretched, knotted, or if the tag is missing.",
        "Ratchets: handle and pawl move freely, no bent handle, the locking tongue snaps back.",
        "Hooks: no bent or opened hooks; the latch (if any) closes fully.",
        "Winch cable: no kinks, flattened spots, or broken wires; hook latch works.",
        "Deck anchor points: no cracked welds or bent rings."
      ],
      problems: [
        ["The vehicle has no tie-down points I can find", "Use wheel nets on all four tires. Or on a truck or SUV, use a strap around a solid frame rail or axle tube with a soft loop. Never use suspension arms, tie rods, exhaust, sway bars or plastic bumper covers."],
        ["The wheels are locked or will not roll", "Do not drag it. Use go-jacks or skates under each locked wheel, then winch the car up the deck."],
        ["The vehicle moves when I push on it after tightening", "Re-tighten each tie-down a few clicks, check the anchor angle, and check the deck anchor is not slipping. Add a fifth tie-down only if you can run it without crossing another strap."],
        ["The strap keeps slipping off an alloy wheel or tire", "Switch to wheel nets. Do not run a strap through the wheel spokes unless the spokes are solid and you add a soft loop."],
        ["There is damage or something leaking", "Photograph it, tell the owner or dispatcher before moving, and do not load a vehicle that is actively leaking fuel."],
        ["The vehicle is an EV with battery damage or smoke", "Stop. Do not load. Call the fire department and dispatch."]
      ]
    };

    return {
      techniques: techniques,
      count: count,
      weightLb: weight,
      legalAggLb: legalAgg,
      recAggLb: recAgg,
      perTiedownLb: per,
      gear: gear,
      methodAdvice: methodAdvice,
      steps: steps,
      wheelLift: wheelLift,
      dollies: dollies,
      operator: operator,
      glossary: glossary
    };
  }

  /* ---------- main entry ---------- */
  function recommend(v, sel) {
    var n = resolve(v, sel);
    var method = towMethod(n);
    var truck = truckClass(n);
    var clr = clearanceCheck(n);
    return {
      tiedown: tiedownPlan(n, method, truck, clr),
      name: n.name,
      spec: n,
      method: method,
      truck: truck,
      clearance: clr,
      warnings: warningsFor(n, method),
      equipment: equipmentFor(n, method, clr, truck),
      checklist: checklistFor(n, method)
    };
  }

  function summaryText(r) {
    var n = r.spec;
    var lines = [];
    lines.push('TOW SUMMARY: ' + r.name + ' (' + n.drive + ', ' + n.power + (n.trans && n.trans !== 'EV' ? ', ' + n.trans : '') + ')');
    lines.push('Method: ' + r.method.primary + (r.method.flatbedOnly ? ' [FLATBED ONLY]' : ''));
    r.method.never.forEach(function (x) { lines.push('  NEVER: ' + x); });
    lines.push('Truck: ' + r.truck.label + ' (rated for ' + fmt(r.truck.requiredLb) + ' lb or more)');
    lines.push('Clearance: ' + r.clearance.gc + ' in, wheelbase ' + r.clearance.wb + ' in, crest ' + r.clearance.angle +
      ' deg -> ' + r.clearance.status.toUpperCase() + ' (needs ' + r.clearance.neededIn + ' in, max safe ' + r.clearance.maxAngleDeg + ' deg)');
    lines.push('Tie-downs: ' + r.tiedown.count + ' points, each rated ' + fmt(r.tiedown.perTiedownLb) + ' lb WLL or more (' + r.tiedown.gear + ')');
    r.warnings.forEach(function (x) { lines.push('  NOTE: ' + x); });
    lines.push('Specs are typical values. Confirm against the vehicle and the owner\'s manual.');
    return lines.join('\n');
  }

  /* ---------- VIN decode (NHTSA vPIC) ---------- */
  function validVin(v) { return /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(v || '').trim()); }

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function titleCase(s) {
    var t = String(s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
    return t === 'Gmc' ? 'GMC' : t;
  }

  function mapDrive(s) {
    s = String(s || '').toUpperCase();
    if (/AWD|ALL.?WHEEL/.test(s)) return 'AWD';
    if (/4WD|4X4|4-WHEEL|FOUR.?WHEEL/.test(s)) return '4WD';
    if (/FWD|FRONT/.test(s)) return 'FWD';
    if (/RWD|REAR/.test(s)) return 'RWD';
    return null;   // "4x2" and blanks are ambiguous
  }

  function mapPower(electrification, fuel) {
    var e = String(electrification || '').toUpperCase();
    var f = String(fuel || '').toUpperCase();
    if (/BEV/.test(e) || (f === 'ELECTRIC' && !/HEV/.test(e))) return 'EV';
    if (/PHEV|PLUG/.test(e)) return 'PHEV';
    if (/MHEV|MILD/.test(e)) return 'ICE';
    if (/HEV|HYBRID/.test(e)) return 'HEV';
    return 'ICE';
  }

  function mapTrans(s) {
    s = String(s || '').toUpperCase();
    if (/DUAL/.test(s)) return 'DCT';
    if (/CVT|CONTINUOUS/.test(s)) return 'CVT';
    if (/MANUAL/.test(s)) return 'MT';
    if (/AUTOMATIC/.test(s)) return 'AT';
    return null;
  }

  function gvwrUpper(s) {
    var m = /([\d,]+)\s*-\s*([\d,]+)\s*lb/i.exec(String(s || ''));
    return m ? parseInt(m[2].replace(/,/g, ''), 10) : null;
  }

  function parseVinDecode(json) {
    var r = json && json.Results && json.Results[0];
    if (!r) return null;
    function get(k) { return r[k] == null ? '' : String(r[k]).trim(); }
    var out = {
      make: titleCase(get('Make')),
      model: get('Model'),
      year: parseInt(get('ModelYear'), 10) || null,
      body: get('BodyClass'),
      drive: mapDrive(get('DriveType')),
      power: mapPower(get('ElectrificationLevel'), get('FuelTypePrimary')),
      trans: mapTrans(get('TransmissionStyle')),
      gvwrLb: gvwrUpper(get('GVWR')),
      message: get('ErrorText')
    };
    out.ok = !!(out.make && out.model);
    return out;
  }

  function guessPreset(body, gvwrLb) {
    var b = String(body || '').toLowerCase();
    if (/pickup/.test(b)) return gvwrLb && gvwrLb > 10000 ? 'dually' : (gvwrLb && gvwrLb > 8500 ? 'hdpickup' : 'pickup');
    if (/minivan|mini-van/.test(b)) return 'minivan';
    if (/van|cargo/.test(b)) return 'van';
    if (/sport utility|suv|crossover|multi/.test(b)) return gvwrLb && gvwrLb > 6000 ? 'suv' : 'crossover';
    if (/coupe|convertible|roadster/.test(b)) return 'sports';
    return 'sedan';
  }

  /* Rank database vehicles against a decoded VIN. */
  function matchVehicles(vehicles, parsed) {
    if (!parsed || !parsed.ok) return [];
    var pm = norm(parsed.model);
    var scored = [];
    vehicles.forEach(function (v) {
      if (norm(v.make) !== norm(parsed.make)) return;
      var nm = norm(String(v.model).replace(/\(.*?\)/g, ''));
      var s = 0;
      if (pm === nm) s = 100;
      else if (pm.indexOf(nm) === 0 || nm.indexOf(pm) === 0) s = 80;
      else if (pm.indexOf(nm) !== -1 || nm.indexOf(pm) !== -1) s = 60;
      if (!s) return;
      if (parsed.year) s += (parsed.year >= v.yFrom && parsed.year <= v.yTo) ? 20 : -40;
      if (parsed.power) s += (parsed.power === v.power) ? 15 : -15;
      if (s > 0) scored.push({ v: v, score: s });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 5).map(function (x) { return x.v; });
  }

  return {
    SAFETY_MARGIN: SAFETY_MARGIN,
    LOW_CLEARANCE_IN: LOW_CLEARANCE_IN,
    ANGLE_PRESETS: ANGLE_PRESETS,
    BODY_PRESETS: BODY_PRESETS,
    resolve: resolve,
    towMethod: towMethod,
    truckClass: truckClass,
    clearanceCheck: clearanceCheck,
    tiedownPlan: tiedownPlan,
    recommend: recommend,
    summaryText: summaryText,
    validVin: validVin,
    parseVinDecode: parseVinDecode,
    matchVehicles: matchVehicles,
    guessPreset: guessPreset,
    mapDrive: mapDrive,
    mapPower: mapPower,
    mapTrans: mapTrans,
    norm: norm,
    fmt: fmt
  };
});
