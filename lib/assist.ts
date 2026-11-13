// Plain-language layer for EconAssist and HazAssist: turns indicators into one status, pictogram tiles and
// spoken-style action sentences in English or Bangla, and keeps the user's profile (job + places) on the device.
import type { EventKind, NearEvent } from "./events";
import { useCallback, useEffect, useState } from "react";
import type { LonLat, ModuleId, RegionData, Scenario } from "./data/types";
import { indicatorsFor, predict, type Indicator, type Prediction, type Status } from "./analysis";
import { API } from "./areas";

export type Lang = "en" | "bn";
export type Job = "farmer" | "fisher" | "miner" | "oil";
type T2 = [en: string, bn: string];

export const JOBS: { id: Job; icon: string; name: T2; scenarios: Scenario[]; place: T2; mine: T2; tap: T2 }[] = [
  { id: "farmer", icon: "sprout", name: ["Farmer", "কৃষক"], scenarios: ["agriculture"], place: ["Where is your farm?", "আপনার জমি কোথায়?"], mine: ["My field", "আমার জমি"], tap: ["Tap your field on the map", "ম্যাপে আপনার জমিতে ট্যাপ করুন"] },
  { id: "fisher", icon: "ship", name: ["Fisher", "জেলে"], scenarios: ["marine"], place: ["Where do you fish?", "আপনি কোথায় মাছ ধরেন?"], mine: ["My fishing ground", "আমার মাছ ধরার এলাকা"], tap: ["Tap where you fish", "যেখানে মাছ ধরেন সেখানে ট্যাপ করুন"] },
  { id: "miner", icon: "pit", name: ["Mine worker", "খনি শ্রমিক"], scenarios: ["mine"], place: ["Where is your mine?", "আপনার খনি কোথায়?"], mine: ["My work site", "আমার কাজের জায়গা"], tap: ["Tap your work site", "আপনার কাজের জায়গায় ট্যাপ করুন"] },
  { id: "oil", icon: "derrick", name: ["Oil & gas worker", "তেল-গ্যাস কর্মী"], scenarios: ["extraction"], place: ["Where is your oil field?", "আপনার তেলক্ষেত্র কোথায়?"], mine: ["My work site", "আমার কাজের জায়গা"], tap: ["Tap your work site", "আপনার কাজের জায়গায় ট্যাপ করুন"] },
];
/** First-run onboarding: who → where (fetching starts) → what NISAR is → why it's hard → how SARsight helps → ready. */
export type Persona = Job | "safe" | "study";
export const ONBOARD = {
  hello: ["This is SARsight", "এটি SARsight"],
  helloSub: ["A radar satellite looks at your land every 12 days. We turn what it sees into plain answers.", "একটি রাডার স্যাটেলাইট প্রতি ১২ দিনে আপনার জমি দেখে। আমরা সেই তথ্যকে সহজ উত্তরে বদলে দিই।"],
  lang: ["Choose your language", "ভাষা বাছুন"],
  start: ["Let's begin", "শুরু করি"],
  who: ["What do you do?", "আপনি কী করেন?"],
  whoSub: ["So we show what matters to you.", "যাতে আপনার দরকারি তথ্যই দেখাই।"],
  safe: ["Keep my family safe", "পরিবারকে নিরাপদ রাখি"],
  study: ["I study the Earth", "আমি পৃথিবী নিয়ে গবেষণা করি"],
  where: ["Where should we look?", "আমরা কোথায় দেখব?"],
  whereSub: ["We start fetching satellite data for this place now, while you see how it works.", "আপনি দেখতে দেখতেই আমরা এই জায়গার স্যাটেলাইট তথ্য আনা শুরু করব।"],
  finding: ["Finding you…", "আপনাকে খুঁজছি…"],
  noLoc: ["Couldn't get your location. Pick a place below.", "অবস্থান পাওয়া যায়নি। নিচে একটি জায়গা বাছুন।"],
  skip: ["Skip for now", "এখন থাক"],
  nisarEyebrow: ["The satellite", "স্যাটেলাইট"],
  nisar: ["Meet NISAR", "নিসারের সাথে পরিচয়"],
  nisarPts: [
    ["NASA and ISRO's radar satellite, launched in 2025.", "নাসা ও ইসরোর রাডার স্যাটেলাইট, ২০২৫ সালে উৎক্ষেপিত।"],
    ["Radar sees through clouds, rain and darkness.", "রাডার মেঘ, বৃষ্টি আর অন্ধকার ভেদ করে দেখে।"],
    ["It passes over the same place every 12 days.", "প্রতি ১২ দিনে একই জায়গার ওপর দিয়ে যায়।"],
    ["It can notice the ground move by less than a centimetre.", "মাটি এক সেন্টিমিটারের কম নড়লেও টের পায়।"],
  ] as T2[],
  hardEyebrow: ["The problem", "সমস্যা"],
  hard: ["Raw radar is hard to use", "কাঁচা রাডার তথ্য বোঝা কঠিন"],
  hardSub: ["Every pass is gigabytes of phase, coherence and decibels. Even experts need days to read it.", "প্রতিটি পাস গিগাবাইটের জটিল সংখ্যা। বিশেষজ্ঞদেরও বুঝতে কয়েক দিন লাগে।"],
  hardFix: ["SARsight reads it for you.", "SARsight আপনার হয়ে তা পড়ে দেয়।"],
  simpleEyebrow: ["The answer", "উত্তর"],
  simple: ["One colour. One sentence. Two pictures.", "একটি রং। একটি বাক্য। দুটি ছবি।"],
  simpleSub: ["Green is good, yellow means be careful, red means danger. Tap Listen to hear it in your language.", "সবুজ মানে ভালো, হলুদ মানে সতর্ক, লাল মানে বিপদ। শুনুন চাপলে নিজের ভাষায় শুনবেন।"],
  demo: { ok: ["Soil is moist. No need to water.", "মাটি ভেজা। এখন সেচ লাগবে না।"], watch: ["Soil is drying. Water in 2–3 days.", "মাটি শুকাচ্ছে। ২–৩ দিনের মধ্যে সেচ দিন।"], alert: ["Field is flooding. Move seed and tools up.", "জমিতে পানি উঠছে। বীজ ও যন্ত্র উঁচুতে রাখুন।"] } as Record<Status, T2>,
  youEyebrow: ["For you", "আপনার জন্য"],
  you: ["How it helps you", "এটি আপনাকে যেভাবে সাহায্য করে"],
  readyEyebrow: ["Almost there", "প্রায় শেষ"],
  preparing: ["Getting your place ready…", "আপনার জায়গা তৈরি হচ্ছে…"],
  fetching: ["Fetching satellite data for your place", "আপনার জায়গার স্যাটেলাইট তথ্য আনা হচ্ছে"],
  ready: ["Your place is ready", "আপনার জায়গা তৈরি"],
  allSet: ["You're all set", "সব প্রস্তুত"],
  failed: ["We couldn't prepare that place, so we picked the nearest one we have.", "জায়গাটি তৈরি করা যায়নি, তাই আমাদের কাছের জায়গাটি দেখানো হচ্ছে।"],
  noPlace: ["You can pick your place inside the app.", "অ্যাপের ভেতরে আপনার জায়গা বাছতে পারবেন।"],
  open: ["Show me", "দেখান"],
  later: ["Continue — it opens when ready", "চালিয়ে যান — তৈরি হলে খুলবে"],
  next: ["Next", "পরের"],
  back: ["Back", "আগের"],
  replay: ["How it works", "কীভাবে কাজ করে"],
} satisfies Record<string, T2 | T2[] | Record<string, T2>>;
export const PERSONA: Record<Persona, { icon: string; pts: T2[] }> = {
  farmer: { icon: "sprout", pts: [["Is my soil too dry, or waterlogged?", "মাটি কি বেশি শুকনো, না পানি জমেছে?"], ["Is my crop growing, and when to harvest?", "ফসল বাড়ছে কি না, কবে কাটবেন?"], ["Is flood water reaching my field?", "জমিতে কি বন্যার পানি আসছে?"]] },
  fisher: { icon: "ship", pts: [["How strong is the wind at sea?", "সাগরে বাতাস কত জোরে?"], ["Dark patches on the water worth a look", "পানিতে কালো দাগ, যা দেখা দরকার"], ["Go out, or stay ashore?", "যাবেন, না তীরে থাকবেন?"]] },
  miner: { icon: "pit", pts: [["Is the ground around the mine sinking?", "খনির চারপাশের মাটি কি দেবে যাচ্ছে?"], ["Are walls and slopes moving?", "দেয়াল বা ঢাল কি নড়ছে?"], ["What changed since the last pass?", "শেষ পাসের পর কী বদলেছে?"]] },
  oil: { icon: "derrick", pts: [["Is the oil field sinking?", "তেলক্ষেত্র কি দেবে যাচ্ছে?"], ["How fast, in centimetres a year?", "বছরে কত সেন্টিমিটার?"], ["Where does the ground move most?", "কোথায় মাটি সবচেয়ে বেশি নড়ছে?"]] },
  safe: { icon: "city", pts: [["Is flood water near my home?", "বাড়ির কাছে কি বন্যার পানি?"], ["Is the ground under my house sinking or sliding?", "বাড়ির নিচের মাটি কি দেবে বা ধসে যাচ্ছে?"], ["Disasters reported nearby", "আশেপাশে দুর্যোগের খবর"]] },
  study: { icon: "globe", pts: [["Every radar layer on a 3D globe", "৩ডি গ্লোবে প্রতিটি রাডার লেয়ার"], ["Drag through time, 12 days at a time", "১২ দিন করে সময়ের ভেতর এগিয়ে যান"], ["Real ground motion from interferograms", "ইন্টারফেরোগ্রাম থেকে বাস্তব মাটির গতিবিধি"]] },
};

export const HOME = { place: ["Where do you live?", "আপনি কোথায় থাকেন?"] as T2, mine: ["My home", "আমার বাড়ি"] as T2, tap: ["Tap your home on the map", "ম্যাপে আপনার বাড়িতে ট্যাপ করুন"] as T2 };

export const UI = {
  who: ["What is your work?", "আপনি কী কাজ করেন?"],
  locate: ["Use my location", "আমার অবস্থান"],
  orPick: ["Or choose a place", "অথবা একটি জায়গা বাছুন"],
  draw: ["Draw the shape instead", "আকার এঁকে দিন"],
  drawArea: ["Check an area", "একটি এলাকা দেখুন"],
  finishHint: ["Tap corners, then tap the first one", "কোণগুলোতে ট্যাপ করুন, শেষে প্রথমটিতে"],
  cancel: ["Cancel", "বাতিল"],
  listen: ["Listen", "শুনুন"],
  stop: ["Stop", "থামান"],
  more: ["More detail", "বিস্তারিত"],
  less: ["Less detail", "কম দেখান"],
  add: ["Add place", "জায়গা যোগ"],
  remove: ["Remove", "মুছুন"],
  job: ["Change work", "কাজ বদলান"],
  passes: ["Each dot is one satellite pass, 12 days apart", "প্রতিটি বিন্দু একটি স্যাটেলাইট পাস, ১২ দিন পরপর"],
  loading: ["Reading radar passes…", "রাডার তথ্য পড়া হচ্ছে…"],
  loadingOf: ["Reading radar passes… {d} of {n}", "রাডার তথ্য পড়া হচ্ছে… {n}-এর মধ্যে {d}"],
  moreData: ["More satellite data loading… {d} of {n}", "আরও স্যাটেলাইট তথ্য আসছে… {n}-এর মধ্যে {d}"],
  status: { ok: ["Good", "ভালো"], watch: ["Careful", "সতর্ক"], alert: ["Danger", "বিপদ"] } as Record<Status, T2>,
  noData: ["No data at your location yet. Nearest:", "আপনার এলাকায় এখনো তথ্য নেই। সবচেয়ে কাছে:"],
  prepTitle: ["No radar data here yet", "এখানে এখনো রাডার তথ্য নেই"],
  prepBody: ["We can prepare this place from free satellite radar. It opens in about a minute; NASA's NISAR radar is added a minute or two later.", "বিনামূল্যের স্যাটেলাইট রাডার থেকে এই জায়গার তথ্য তৈরি করা যায়। প্রায় এক মিনিটে খুলবে; নাসার নিসার রাডার যোগ হবে আরও এক-দুই মিনিট পরে।"],
  prepGo: ["Prepare this place", "তথ্য তৈরি করুন"],
  prepWait: ["Preparing your place…", "আপনার জায়গার তথ্য তৈরি হচ্ছে…"],
  prepFail: ["Could not prepare this place", "তথ্য তৈরি করা যায়নি"],
  retry: ["Try again", "আবার চেষ্টা করুন"],
  partial: ["Part of this area is outside the analysed square.", "এই এলাকার কিছু অংশ বিশ্লেষিত এলাকার বাইরে।"],
  prepWhole: ["Prepare the whole area", "পুরো এলাকার তথ্য তৈরি করুন"],
  offline: ["The area service is offline.", "সার্ভার এখন বন্ধ।"],
  prepBg: ["Keeps going if you switch tabs", "অন্য ট্যাবে গেলেও চলতে থাকবে"],
  prepReady: ["Your place is ready", "আপনার জায়গার তথ্য তৈরি"],
  nisarAdding: ["Adding NASA NISAR…", "নাসার নিসার যোগ হচ্ছে…"],
  nisarAdded: ["NASA NISAR radar added", "নাসার নিসার রাডার যোগ হয়েছে"],
  nisarNone: ["NISAR has not passed over this place yet", "নিসার এখনো এই জায়গার উপর দিয়ে যায়নি"],
  prepLost: ["The area service restarted. Please try again.", "সার্ভার আবার চালু হয়েছে। আবার চেষ্টা করুন।"],
  prepBusy: ["Another place is being prepared. Please wait for it to finish.", "আরেকটি জায়গার তথ্য তৈরি হচ্ছে। শেষ হওয়া পর্যন্ত অপেক্ষা করুন।"],
  open: ["Open", "খুলুন"],
  queued: ["Waiting in line", "লাইনে অপেক্ষা"],
  editShape: ["Edit shape", "আকার বদলান"],
  editHint: ["Drag corners · drag + to add · double-tap a corner to remove", "কোণ টেনে সরান · + টেনে নতুন কোণ · কোণে দুইবার চাপলে মুছবে"],
  save: ["Save", "সংরক্ষণ"],
  undo: ["Undo", "ফেরান"],
  rename: ["Rename", "নাম বদলান"],
  search: ["Search a village, town or area", "গ্রাম, শহর বা এলাকার নাম লিখুন"],
  searchGo: ["Search", "খুঁজুন"],
  noResults: ["Nothing found. Try a nearby town.", "কিছু পাওয়া যায়নি। কাছের কোনো শহরের নাম দিন।"],
  searchFail: ["Search is not available right now.", "এখন খোঁজা যাচ্ছে না।"],
  labels: ["Place names", "জায়গার নাম"],
  seeMap: ["See it on the map", "ম্যাপে দেখুন"],
  hideMap: ["Hide map", "ম্যাপ লুকান"],
  grow: ["Bigger globe", "বড় গ্লোব"],
  shrink: ["Smaller globe", "ছোট গ্লোব"],
  nearby: ["Reported nearby", "আশেপাশে খবর"],
  noneNear: ["No floods, storms or fires reported within 300 km this month.", "এই মাসে ৩০০ কিমির মধ্যে বন্যা, ঝড় বা আগুনের খবর নেই।"],
  themeLight: ["Light mode", "লাইট মোড"],
  themeDark: ["Dark mode", "ডার্ক মোড"],
} satisfies Record<string, T2 | Record<string, T2>>;

export const tr = (s: T2, lang: Lang) => s[lang === "en" ? 0 : 1];
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const num = (s: string, lang: Lang) => (lang === "bn" ? s.replace(/\d/g, (d) => BN_DIGITS[+d]) : s);

const TILES: Record<Scenario, string[]> = {
  agriculture: ["moisture", "stage"], marine: ["wind", "slick"], mine: ["velocity", "sinkholes"], extraction: ["velocity", "safety"],
  flood: ["water", "rain"], earthquake: ["built", "shift"], subsidence: ["velocity", "safety"], landslide: ["velocity", "surface"], volcano: ["velocity", "surface"],
};
const TILE: Record<string, { icon: string; label: T2 }> = {
  moisture: { icon: "drop", label: ["Soil water", "মাটির পানি"] }, stage: { icon: "sprout", label: ["Crop", "ফসল"] },
  wind: { icon: "ship", label: ["Wind", "বাতাস"] }, slick: { icon: "wave", label: ["Sea", "সাগর"] },
  water: { icon: "wave", label: ["Flood", "বন্যা"] }, rain: { icon: "drop", label: ["Rain", "বৃষ্টি"] },
  built: { icon: "city", label: ["Buildings", "ভবন"] }, shift: { icon: "quake", label: ["Ground", "মাটি"] },
  velocity: { icon: "mountain", label: ["Ground", "মাটি"] }, sinkholes: { icon: "pit", label: ["Sinkholes", "গর্ত"] },
  surface: { icon: "layers", label: ["Surface", "ভূপৃষ্ঠ"] }, safety: { icon: "city", label: ["Buildings", "ভবন"] },
};

const SAY: Record<string, Record<string, T2>> = {
  moisture: {
    Dry: ["Soil is dry. Water your field in the next 2 to 3 days.", "মাটি শুকনো। আগামী ২–৩ দিনের মধ্যে জমিতে সেচ দিন।"],
    Waterlogged: ["Too much water in the field. Open the drains.", "জমিতে পানি বেশি। নালা খুলে দিন।"],
    Good: ["Soil moisture is good. No watering needed now.", "মাটির আর্দ্রতা ভালো। এখন সেচ লাগবে না।"],
  },
  stage: {
    Stressed: ["Crop growth has dropped. Check for pests, disease or thirst.", "ফসলের বৃদ্ধি কমে গেছে। পোকা, রোগ বা পানির অভাব আছে কিনা দেখুন।"],
    Stalled: ["Crop growth has slowed. Keep an eye on it.", "ফসলের বৃদ্ধি ধীর হয়েছে। নজর রাখুন।"],
    Mature: ["Crop is ripe. Get ready to harvest: {h}.", "ফসল পেকেছে। কাটার প্রস্তুতি নিন: {h}।"],
    Growing: ["Crop is growing well. Likely harvest: {h}.", "ফসল ভালোভাবে বাড়ছে। সম্ভাব্য কাটার সময়: {h}।"],
    "Bare / sown": ["Field is bare or newly sown.", "জমি ফাঁকা বা নতুন বোনা।"],
    Harvested: ["Harvest is done.", "ফসল কাটা হয়ে গেছে।"],
    "Too early": ["Too early to judge the crop.", "ফসল বোঝার জন্য এখনো আগাম।"],
    "No crop cycle": ["No crop growing here this season.", "এই মৌসুমে এখানে ফসল দেখা যাচ্ছে না।"],
    "No cropland": ["No farmland found at this spot.", "এখানে চাষের জমি পাওয়া যায়নি।"],
  },
  wind: {
    "Stay ashore": ["Strong wind at sea. Stay ashore.", "সাগরে জোরালো বাতাস। তীরে থাকুন।"],
    "Fish with care": ["Wind is picking up. Fish close to shore.", "বাতাস বাড়ছে। তীরের কাছে মাছ ধরুন।"],
    "Safe to fish": ["Calm sea. Safe to fish.", "সাগর শান্ত। মাছ ধরা নিরাপদ।"],
  },
  slick: {
    Clear: ["No unusual dark patches at sea.", "সাগরে অস্বাভাবিক কালো দাগ নেই।"],
    "Calm sea — likely look-alike": ["Calm patches on the water. Probably not oil.", "পানিতে শান্ত দাগ। সম্ভবত তেল নয়।"],
    "Inspect: oil or calm water": ["Dark patch at sea, maybe oil. Avoid it and tell the coast guard.", "সাগরে কালো দাগ, তেল হতে পারে। এড়িয়ে চলুন, কোস্টগার্ডকে জানান।"],
  },
  water: {
    Flooded: ["Your area is flooded. Move people, cattle and food to high ground.", "আপনার এলাকা ডুবে গেছে। মানুষ, গবাদিপশু ও খাবার উঁচু জায়গায় সরান।"],
    "High water": ["Water is high. Keep things raised and be ready to move.", "পানি বেড়েছে। জিনিসপত্র উঁচুতে রাখুন, সরে যাওয়ার প্রস্তুতি নিন।"],
    Normal: ["No flooding here.", "এখানে বন্যা নেই।"],
  },
  rain: {
    Extreme: ["Extreme rain in the last 12 days. Water may rise more.", "গত ১২ দিনে প্রচণ্ড বৃষ্টি। পানি আরও বাড়তে পারে।"],
    Heavy: ["Heavy rain recently.", "সম্প্রতি ভারী বৃষ্টি হয়েছে।"],
    Moderate: ["Normal rain.", "স্বাভাবিক বৃষ্টি।"],
  },
  built: {
    "Heavy damage likely": ["Many buildings may be damaged. Do not go inside until checked.", "অনেক ভবন ক্ষতিগ্রস্ত হতে পারে। পরীক্ষা না করে ভেতরে যাবেন না।"],
    "Damage likely": ["Some buildings may be damaged. Check walls for cracks.", "কিছু ভবন ক্ষতিগ্রস্ত হতে পারে। দেয়ালে ফাটল দেখুন।"],
    "Little change": ["Buildings here look unchanged.", "এখানকার ভবনে বড় পরিবর্তন নেই।"],
  },
  shift: {
    Ruptured: ["The ground broke and moved here.", "এখানে মাটি ফেটে সরে গেছে।"],
    Shifted: ["The ground moved a little.", "মাটি সামান্য সরেছে।"],
    Stable: ["The ground is steady.", "মাটি স্থির।"],
  },
  sinkholes: {
    Detected: ["Possible sinkhole. Keep away from the marked spot.", "গর্ত তৈরি হতে পারে। চিহ্নিত জায়গা থেকে দূরে থাকুন।"],
    None: ["No sinkholes seen.", "কোনো গর্ত দেখা যায়নি।"],
  },
  surface: {
    Active: ["The surface is changing: digging, slides or new building.", "ভূপৃষ্ঠ বদলাচ্ছে: খনন, ধস বা নির্মাণ।"],
    Steady: ["The surface is unchanged.", "ভূপৃষ্ঠ অপরিবর্তিত।"],
  },
  safety: {
    Inspect: ["Buildings stand on moving ground. Have them checked.", "ভবনগুলো নড়তে থাকা মাটিতে। পরীক্ষা করান।"],
    Monitor: ["Some buildings stand on slowly moving ground.", "কিছু ভবন ধীরে নড়তে থাকা মাটিতে।"],
    Safe: ["Buildings stand on steady ground.", "ভবনগুলো স্থির মাটিতে।"],
  },
};
const VELOCITY: Partial<Record<Scenario, Record<string, T2>>> & { default: Record<string, T2> } = {
  default: {
    Unsafe: ["The ground is sinking fast. Look for new cracks in walls and floors.", "মাটি দ্রুত বসে যাচ্ছে। দেয়াল ও মেঝেতে নতুন ফাটল দেখুন।"],
    Moving: ["The ground is slowly sinking. Watch for new cracks.", "মাটি ধীরে বসে যাচ্ছে। নতুন ফাটলে নজর রাখুন।"],
    Stable: ["The ground is steady.", "মাটি স্থির।"],
  },
  mine: {
    Unsafe: ["The ground is moving fast. Tell your supervisor and keep away from edges.", "মাটি দ্রুত নড়ছে। সুপারভাইজারকে জানান, কিনারা থেকে দূরে থাকুন।"],
    Moving: ["The ground is slowly moving. Report new cracks.", "মাটি ধীরে নড়ছে। নতুন ফাটল দেখলে জানান।"],
    Stable: ["The ground is steady. Safe to work.", "মাটি স্থির। কাজ করা নিরাপদ।"],
  },
  landslide: {
    Unsafe: ["The slope is sliding. Leave if heavy rain comes.", "ঢাল ধসে পড়ছে। ভারী বৃষ্টি হলে সরে যান।"],
    Moving: ["The slope is slowly moving. Watch it after rain.", "ঢাল ধীরে নড়ছে। বৃষ্টির পরে নজর রাখুন।"],
    Stable: ["The slope is steady.", "ঢাল স্থির।"],
  },
  volcano: {
    Unrest: ["The volcano is swelling fast. Follow official alerts and know your way out.", "আগ্নেয়গিরি দ্রুত ফুলছে। সরকারি সতর্কতা মানুন, বের হওয়ার পথ জেনে রাখুন।"],
    Inflating: ["The ground is slowly rising. Stay informed.", "মাটি ধীরে উঠছে। খবর রাখুন।"],
    Quiet: ["The volcano is quiet.", "আগ্নেয়গিরি শান্ত।"],
  },
};

export interface Tile { key: string; icon: string; label: string; status: Status; preview: boolean; say: string }
export interface Advice { status: Status; tiles: Tile[]; lines: string[]; preview: boolean; prediction?: Prediction }
const rank: Record<Status, number> = { ok: 0, watch: 1, alert: 2 };

export function advise(r: RegionData, t: number, poly: LonLat[], lang: Lang): Advice {
  const sc = r.manifest.scenario, inds = indicatorsFor(r, t, poly), by = new Map(inds.map((i) => [i.key, i]));
  const harvest = by.get("harvest")?.value ?? "";
  const picked = TILES[sc].map((k) => by.get(k)).filter((i): i is Indicator => !!i);
  const tiles = (picked.length ? picked : inds.slice(0, 2)).map((i): Tile => {
    const table = i.key === "velocity" ? VELOCITY[sc] ?? VELOCITY.default : SAY[i.key];
    const s = table?.[i.word];
    const say = s ? num(tr(s, lang).replace("{h}", harvest), lang) : `${i.label}: ${i.word}`;
    return { key: i.key, icon: i.key === "velocity" && sc === "volcano" ? "volcano" : TILE[i.key]?.icon ?? "layers", label: TILE[i.key] ? tr(TILE[i.key].label, lang) : i.label, status: i.status, preview: !!i.preview, say };
  });
  // worst first; on a tie, an observed tile leads over a preview one
  const order = [...tiles].sort((a, b) => rank[b.status] - rank[a.status] || Number(a.preview) - Number(b.preview));
  const status = order[0]?.status ?? "ok";
  const prediction = predict(r, t, poly, lang) ?? undefined;
  return { status, tiles, lines: order.map((x) => x.say), preview: tiles.some((x) => x.preview), prediction };
}

export const statusHistory = (r: RegionData, poly: LonLat[]): Status[] =>
  r.manifest.epochs.map((_, t) => advise(r, t, poly, "en").status);

/** Small square (side 2·cells+1 grid cells) centred on a tapped point. */
export function squareAround(r: RegionData, [lon, lat]: LonLat, cells = 1.5): LonLat[] {
  const [w, s, e, n] = r.manifest.bbox, dx = ((e - w) / r.manifest.grid.cols) * cells, dy = ((n - s) / r.manifest.grid.rows) * cells;
  return [[lon - dx, lat + dy], [lon + dx, lat + dy], [lon + dx, lat - dy], [lon - dx, lat - dy]];
}

export const EVENT: Record<EventKind, { icon: string; name: T2 }> = {
  floods: { icon: "drop", name: ["Flood", "বন্যা"] },
  severeStorms: { icon: "storm", name: ["Storm", "ঝড়"] },
  wildfires: { icon: "fire", name: ["Fire", "আগুন"] },
  earthquakes: { icon: "quake", name: ["Earthquake", "ভূমিকম্প"] },
  volcanoes: { icon: "volcano", name: ["Volcano", "আগ্নেয়গিরি"] },
  landslides: { icon: "mountain", name: ["Landslide", "ভূমিধস"] },
  drought: { icon: "sun", name: ["Drought", "খরা"] },
  tempExtremes: { icon: "sun", name: ["Extreme heat or cold", "তীব্র গরম বা শীত"] },
  dustHaze: { icon: "wave", name: ["Dust or haze", "ধুলা বা ধোঁয়াশা"] },
};
/** close and still active → danger; otherwise be careful */
export const eventStatus = (e: NearEvent): Status => (e.open && e.km <= 50 ? "alert" : "watch");
export function eventLine(e: NearEvent, lang: Lang) {
  const days = Math.max(0, Math.round((Date.now() - Date.parse(e.date)) / 864e5));
  const when = days === 0 ? tr(["today", "আজ"], lang) : num(lang === "bn" ? `${days} দিন আগে` : `${days} day${days > 1 ? "s" : ""} ago`, lang);
  return lang === "bn" ? `${num(String(e.km), lang)} কিমি দূরে ${tr(EVENT[e.kind].name, lang)}, ${when}` : `${tr(EVENT[e.kind].name, lang)} ${e.km} km away, ${when}`;
}

let currentAudio: HTMLAudioElement | null = null;
const speakingListeners = new Set<(playing: boolean) => void>();
let isSpeakingState = false;

function notifySpeaking(playing: boolean) {
  isSpeakingState = playing;
  speakingListeners.forEach((fn) => fn(playing));
}

export function useSpeaking() {
  const [playing, setPlaying] = useState(isSpeakingState);
  useEffect(() => {
    speakingListeners.add(setPlaying);
    return () => {
      speakingListeners.delete(setPlaying);
    };
  }, []);
  return playing;
}

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
  }
  notifySpeaking(false);
}

const CREEPY_VOICE = /albert|bad news|bahh|bells|boing|cellos|deranged|fred|good news|hysterical|pipe organ|trinoids|whisper|zarvox/i;

function speakWebSpeechFallback(text: string, lang: Lang): boolean {
  if (typeof speechSynthesis === "undefined") return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "bn" ? "bn-BD" : "en-US";

  const voices = speechSynthesis.getVoices().filter((v) => !CREEPY_VOICE.test(v.name));
  let picked: SpeechSynthesisVoice | undefined;

  if (lang === "bn") {
    picked = voices.find((v) => v.lang.toLowerCase().startsWith("bn") && /(google|natural|neural|bangla|bengali)/i.test(v.name))
          ?? voices.find((v) => v.lang.toLowerCase().startsWith("bn"));
    // Never fallback to an English voice for Bengali text: it sounds completely garbled and distorted
    if (!picked) return false;
  } else {
    picked = voices.find((v) => v.lang.toLowerCase().startsWith("en") && /(google|samantha|daniel|karen|siri|natural|neural|ava|jenny|guy|premium|enhanced)/i.test(v.name))
          ?? voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  }

  if (picked) u.voice = picked;
  u.rate = 1.0;
  u.pitch = 1.0;
  u.onstart = () => notifySpeaking(true);
  u.onend = () => notifySpeaking(false);
  u.onerror = () => notifySpeaking(false);
  speechSynthesis.speak(u);
  return true;
}

export function speak(text: string, lang: Lang) {
  if (currentAudio && !currentAudio.paused) {
    stopSpeaking();
    return true;
  }
  stopSpeaking();

  const url = `${API}/api/tts?text=${encodeURIComponent(text)}&lang=${lang}`;
  const audio = new Audio(url);
  currentAudio = audio;
  audio.onplay = () => notifySpeaking(true);
  audio.onended = () => {
    if (currentAudio === audio) currentAudio = null;
    notifySpeaking(false);
  };
  audio.onpause = () => {
    if (currentAudio === audio) notifySpeaking(false);
  };
  audio.onerror = () => {
    if (currentAudio === audio) currentAudio = null;
    speakWebSpeechFallback(text, lang);
  };
  audio.play().catch(() => {
    speakWebSpeechFallback(text, lang);
  });
  return true;
}

// ---------- profile, stored on this device only ----------
export interface Site { id: string; region: string; name: string; poly: LonLat[] }
export type Theme = "dark" | "light";
interface Profile { lang: Lang; theme?: Theme; job: Job | null; sites: Record<"econ" | "haz", Site[]> }
const KEY = "sarsight.profile.v1";
const EMPTY: Profile = { lang: "en", theme: "dark", job: null, sites: { econ: [], haz: [] } };

export function getStoredProfile(): Profile {
  if (typeof window === "undefined") return EMPTY;
  try { const s = localStorage.getItem(KEY); if (s) return { ...EMPTY, ...JSON.parse(s) }; } catch { /* unavailable */ }
  return EMPTY;
}

export function useProfile() {
  const [p, setP] = useState<Profile>(getStoredProfile);
  const save = useCallback((f: (q: Profile) => Profile) => setP((q) => {
    const next = f(q);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  }), []);
  return {
    ...p,
    theme: p.theme ?? "dark",
    setLang: (lang: Lang) => save((q) => ({ ...q, lang })),
    setTheme: (theme: Theme) => save((q) => ({ ...q, theme })),
    setJob: (job: Job | null) => save((q) => ({ ...q, job })),
    addSite: (m: ModuleId, s: Site) => m !== "vis" && save((q) => ({ ...q, sites: { ...q.sites, [m]: [...q.sites[m], s] } })),
    updateSite: (m: ModuleId, id: string, ch: Partial<Site>) => m !== "vis" && save((q) => ({ ...q, sites: { ...q.sites, [m]: q.sites[m].map((x) => (x.id === id ? { ...x, ...ch } : x)) } })),
    removeSite: (m: ModuleId, id: string) => m !== "vis" && save((q) => ({ ...q, sites: { ...q.sites, [m]: q.sites[m].filter((x) => x.id !== id) } })),
  };
}

/** Backend job stages (prepare.py) -> plain words and how far along the job is. */
const PREP_STAGES: Record<string, [T2, number]> = {
  "Sending": [["Sending your place", "আপনার জায়গা পাঠানো হচ্ছে"], 3],
  "Waiting to start": [["Waiting to start", "শুরুর অপেক্ষায়"], 6],
  "Finding Sentinel-1 passes": [["Finding satellite passes", "স্যাটেলাইট পাস খোঁজা হচ্ছে"], 12],
  "Downloading Sentinel-1 radar passes": [["Downloading radar images", "রাডার ছবি নামানো হচ্ছে"], 28],
  "Reading L-band, elevation and land cover": [["Reading land height and land type", "জমির উচ্চতা ও ধরন পড়া হচ্ছে"], 48],
  "Reading 38 years of water history": [["Reading 38 years of water history", "৩৮ বছরের পানির ইতিহাস পড়া হচ্ছে"], 58],
  "Checking NISAR passes": [["Checking NASA NISAR passes", "নাসার নিসার পাস দেখা হচ্ছে"], 66],
  "Reading NISAR L-band radar": [["Reading NASA NISAR radar", "নাসার নিসার রাডার পড়া হচ্ছে"], 74],
  "Building layers": [["Building your map", "মানচিত্র তৈরি হচ্ছে"], 94],
  "Saving NISAR layers": [["Saving NASA NISAR layers", "নাসার নিসার লেয়ার রাখা হচ্ছে"], 90],
  "Ready": [["Ready", "তৈরি"], 100],
};

export function prepProgress(stage: string | undefined, position: number | undefined, lang: Lang): { text: string; pct: number } {
  if (position) return { text: `${tr(UI.queued, lang)} #${num(String(position), lang)}`, pct: 4 };
  const [label, pct] = PREP_STAGES[stage ?? ""] ?? [[stage ?? "", stage ?? ""], 40];
  return { text: tr(label, lang), pct };
}

/** Guided tour for NASA Space Apps judges (open with the header button or ?judge). */
export const JUDGE = {
  button: ["For judges", "বিচারকদের জন্য"],
  invite: ["Judging? Take the 1-minute tour", "বিচারক? ১ মিনিটের পরিচিতি দেখুন"],
  eyebrow: ["NASA Space Apps 2026 · Dancing with the SARs", "নাসা স্পেস অ্যাপস ২০২৬ · ড্যান্সিং উইথ দ্য SARs"],
  hello: ["Welcome, judges", "স্বাগতম, বিচারকগণ"],
  helloSub: ["SARsight turns NASA-ISRO NISAR radar into plain answers that farmers, fishers and families can act on, plus a full research globe for experts.", "SARsight নাসা-ইসরোর নিসার রাডারকে সহজ উত্তরে বদলায়, যা কৃষক, জেলে ও পরিবার কাজে লাগাতে পারে; আর বিশেষজ্ঞদের জন্য আছে পূর্ণ গবেষণা গ্লোব।"],
  three: ["One radar, three audiences", "এক রাডার, তিন ধরনের ব্যবহারকারী"],
  econ: ["Farmers, fishers and mine workers get one colour, one sentence and two pictures, read aloud in Bangla.", "কৃষক, জেলে ও খনিশ্রমিক পান একটি রং, একটি বাক্য আর দুটি ছবি, বাংলায় পড়ে শোনানো হয়।"],
  haz: ["Residents ask one question: is my home safe, and what should I do?", "বাসিন্দারা জানতে পারেন: আমার বাড়ি কি নিরাপদ, আমার কী করা উচিত?"],
  vis: ["Researchers get every layer on a 4D globe: time slider, swipe, profiles and sources.", "গবেষকরা পান ৪ডি গ্লোবে সব লেয়ার: সময় স্লাইডার, তুলনা, প্রোফাইল ও উৎস।"],
  nisarEyebrow: ["Real data · nothing simulated", "বাস্তব উপাত্ত · কিছুই সিমুলেটেড নয়"],
  nisar: ["NISAR at the core", "কেন্দ্রে নিসার"],
  nisarPts: [
    ["NISAR L-band radar measurements are built into the ready places", "তৈরি জায়গাগুলোতে নিসার এল-ব্যান্ড রাডার পরিমাপ আগেই যুক্ত"],
    ["NISAR ground motion over time in Mexico City, one of the fastest-sinking cities on Earth", "মেক্সিকো সিটিতে নিসারের মাটির গতিবিধি, পৃথিবীর দ্রুততম ডুবে যাওয়া শহরগুলোর একটি"],
    ["Sentinel-1, ALOS-2 and NASA POWER fill in the rest of the story", "সেন্টিনেল-১, অ্যালোস-২ ও নাসা পাওয়ার বাকি গল্প পূরণ করে"],
    ["Every source is credited under Data sources, NASA first", "প্রতিটি উৎস 'উপাত্তের উৎস'-এ দেওয়া আছে, নাসা আগে"],
  ],
  try: ["Try it instantly", "এখনই দেখুন"],
  trySub: ["These places are ready and open straight away. No waiting.", "এই জায়গাগুলো তৈরি, সঙ্গে সঙ্গে খোলে। অপেক্ষা নেই।"],
  nisarTag: ["NISAR", "নিসার"],
  anyEyebrow: ["Build your own", "নিজের জায়গা তৈরি করুন"],
  any: ["Or anywhere on Earth", "অথবা পৃথিবীর যেকোনো জায়গা"],
  anyPts: [
    ["Search a town or draw an area", "শহরের নাম খুঁজুন বা এলাকা আঁকুন"],
    ["It opens in about a minute, built from free satellite data", "বিনামূল্যের স্যাটেলাইট তথ্য থেকে প্রায় এক মিনিটে খোলে"],
    ["NASA NISAR radar is added 1–2 minutes later, in the background. Keep exploring meanwhile", "নাসার নিসার রাডার ১–২ মিনিট পরে পেছনে যোগ হয়। এর মধ্যে ঘুরে দেখুন"],
  ],
  short: ["Short on time? Stick to the ready places: everything is already there.", "সময় কম? তৈরি জায়গাগুলো দেখুন: সব আগেই আছে।"],
  server: ["New places need our area server. If it is offline, the ready places still work fully.", "নতুন জায়গার জন্য আমাদের সার্ভার লাগে। সেটি বন্ধ থাকলেও তৈরি জায়গাগুলো পুরোপুরি কাজ করে।"],
  seeReady: ["See ready places", "তৈরি জায়গাগুলো দেখুন"],
  explore: ["Start exploring", "ঘুরে দেখা শুরু করুন"],
} satisfies Record<string, T2 | T2[]>;
