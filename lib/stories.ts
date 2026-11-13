// Short, plain-language context per region: the physical driver, how radar sees it, and what NISAR adds.
export interface StoryContent { what: string; radar: string; nisar: string; look: string }
export interface Story extends StoryContent { bn?: StoryContent }

export const STORIES: Record<string, Story> = {
  "rajshahi-barind": {
    what: "The Barind Tract is higher, drier ground than the rest of Bangladesh. Irrigation from deep wells lets farmers grow a dry-season crop, but it draws down groundwater.",
    radar: "VH (cross-polarised) echoes come from leaves and stems, so they rise as the canopy grows and fall after harvest. VV responds more to wet soil.",
    nisar: "NISAR's L-band reaches through the canopy to the soil, and its 12-day repeat catches each growth stage, even under monsoon cloud.",
    look: "Play the timeline: fields go dark after sowing in December, brighten through February, then drop at harvest.",
    bn: {
      what: "বরেন্দ্র অঞ্চল বাংলাদেশের অন্যান্য অঞ্চলের চেয়ে উঁচু ও শুষ্ক ভূমি। গভীর নলকূপ থেকে সেচ দিয়ে কৃষকেরা শুষ্ক মৌসুমে বোরো ফসল ফলান, তবে এতে ভূগর্ভস্থ পানির স্তর ক্রমশ নিচে নেমে যাচ্ছে।",
      radar: "ভিএইচ (ক্রস-পোলারাইজড) রাডার প্রতিধ্বনি গাছের পাতা ও কাণ্ড থেকে আসে, তাই ফসলের বৃদ্ধির সাথে সাথে এটি উজ্জ্বল হয় এবং ফসল কাটার পর কমে যায়। ভিভি সংকেত ভেজা মাটির প্রতি বেশি সংবেদনশীল।",
      nisar: "নিসারের এল-ব্যান্ড রাডার ফসলের পাতার স্তর ভেদ করে সরাসরি মাটিতে পৌঁছায় এবং এর ১২ দিনের চক্র বর্ষার মেঘের মধ্যেও ফসলের প্রতিটি পর্যায় নিয়মিত পর্যবেক্ষণ করতে পারে।",
      look: "টাইমলাইন চালিয়ে দেখুন: ডিসেম্বরে বীজ বপনের পর জমিগুলো অন্ধকার দেখায়, ফেব্রুয়ারিতে উজ্জ্বল হয় এবং ফসল তোলার পর দ্রুত গাঢ় হয়ে যায়।",
    },
  },
  "bay-of-bengal": {
    what: "Ships heading for Chattogram port cross these waters. Wind, currents and the Karnaphuli river plume all change the sea surface.",
    radar: "Wind roughens the sea and makes it bright. Oil smooths the small waves, leaving dark streaks. Very calm water also looks dark, so wind context matters.",
    nisar: "NISAR adds L-band ocean imagery every 12 days and sees through cyclone cloud, a useful second look alongside Sentinel-1.",
    look: "Switch to Wind, then back to Slick: dark patches inside windy water are the ones worth checking.",
    bn: {
      what: "চট্টগ্রাম বন্দরের দিকে যাওয়া জাহাজগুলো এই জলসীমা অতিক্রম করে। বাতাস, সমুদ্রের স্রোত এবং কর্ণফুলী নদীর প্রবাহ সাগরের উপরিভাগকে ক্রমাগত পরিবর্তন করে।",
      radar: "বাতাস সমুদ্রের পৃষ্ঠতলকে উত্তাল ও রাডারে উজ্জ্বল করে তোলে। তেল ছোট ছোট ঢেউকে মসৃণ করে দেয়, ফলে রাডারে কালো রেখার মতো দেখায়। শান্ত পানিও অন্ধকার দেখায়, তাই বাতাসের গতি জানা জরুরি।",
      nisar: "নিসার প্রতি ১২ দিনে এল-ব্যান্ড সমুদ্রের চিত্র প্রদান করে এবং ঘূর্ণিঝড়ের ঘন মেঘ ভেদ করতে পারে, যা সেন্টিনেল-১ এর পাশাপাশি অত্যন্ত কার্যকর দ্বিতীয় পর্যবেক্ষণ।",
      look: "বাতাস (Wind) মোডে গিয়ে আবার তেলের স্তর (Slick) মোডে ফিরে আসুন: উত্তাল ঢেউয়ের মধ্যেও যেসব এলাকা অন্ধকার থাকে সেগুলো বিশেষভাবে খতিয়ে দেখার মতো।",
    },
  },
  barapukuria: {
    what: "Bangladesh's only coal mine works an underground seam. As panels are mined out, the ground above sags and nearby villages report cracking.",
    radar: "Interferometry measures the slow sag to the centimetre. Sudden local drops show up as sinkholes between two passes.",
    nisar: "L-band keeps coherence over the rice paddies here, where shorter-wavelength radars lose track between passes.",
    look: "Open the Motion layer and watch the ground above the longwall panels move pass by pass.",
    bn: {
      what: "বাংলাদেশের একমাত্র কয়লা খনি যেখানে ভূগর্ভস্থ কয়লা উত্তোলন করা হয়। ভূগর্ভস্থ স্তর থেকে কয়লা তোলার ফলে উপরিভাগের মাটি ধীরে ধীরে দেবে যায় এবং আশেপাশের গ্রামে ফাটল দেখা দেয়।",
      radar: "ইন্টারফেরোমেট্রি সেন্টিমিটার স্কেলে মাটির ধীর অবনমন পরিমাপ করে। দুটি পাসের মধ্যবর্তী হঠাৎ স্থানীয় পতন সিঙ্কহোল হিসেবে দৃশ্যমান হয়।",
      nisar: "এল-ব্যান্ড এখানকার ধানক্ষেতের ওপর সুসংগততা ধরে রাখতে সক্ষম, যেখানে কম তরঙ্গদৈর্ঘ্যের রাডার দুটি পাসের মাঝে সংকেত হারিয়ে ফেলে।",
      look: "মোশন (Motion) লেয়ারটি খুলুন এবং প্রতিটি পাসে খনির ওপরের মাটি কীভাবে নড়ে তা দেখুন।",
    },
  },
  "bingham-canyon": {
    what: "One of the world's largest open-pit mines. In 2013 its NE wall slid in a huge but predicted landslide; radar monitoring helped give the warning.",
    radar: "Accelerating creep on a pit wall is the classic warning sign. Brightness change marks fresh rock faces and benches.",
    nisar: "A free, regular, global record of pit-wall motion, useful for mines that cannot afford ground radar.",
    look: "Draw an area on a pit wall and watch the surface change pass by pass.",
    bn: {
      what: "বিশ্বের বৃহত্তম উন্মুক্ত তামার খনিগুলোর একটি। ২০১৩ সালে এর উত্তর-পূর্ব দেয়াল এক বিশাল ভূমিধসে ধসে পড়েছিল; রাডার পর্যবেক্ষণের কারণেই পূর্ব সতর্কবার্তা দেওয়া সম্ভব হয়েছিল।",
      radar: "খনি দেয়ালের স্থানচ্যুতির গতি বৃদ্ধি পাওয়া আসন্ন ধসের স্পষ্ট লক্ষণ। উজ্জ্বলতার পরিবর্তন উন্মুক্ত তাজা শিলা ও ধাপ নির্দেশ করে।",
      nisar: "খনি দেয়াল নড়াচড়ার একটি নিয়মিত উন্মুক্ত বৈশ্বিক রেকর্ড, যা ব্যয়বহুল গ্রাউন্ড রাডার ব্যবহারে অক্ষম খনিগুলোর জন্য অত্যন্ত সহায়ক।",
      look: "খনির একটি দেয়ালে একটি এলাকা আঁকুন এবং প্রতিটি পাসে উপরিভাগের পরিবর্তন দেখুন।",
    },
  },
  "lost-hills": {
    what: "Pumping oil and water from shallow reservoirs compacts the rock beneath this San Joaquin Valley oil field, and the surface sinks along the field's axis.",
    radar: "InSAR maps the elongated subsidence trough. Brightness stays steady because the surface itself barely changes.",
    nisar: "Routine subsidence maps let operators and regulators see well-casing and pipeline risk early.",
    look: "Draw a Profile across the field to see the trough.",
    bn: {
      what: "অগভীর আধার থেকে তেল ও পানি তোলার কারণে এই তেলক্ষেত্রের নিচের শিলা সংকুচিত হয় এবং প্রধান অক্ষ বরাবর ভূপৃষ্ঠ দেবে যায়।",
      radar: "ইনসার লম্বাটে অবনমন খাদটি নিখুঁতভাবে চিহ্নিত করে। ভূপৃষ্ঠ সামান্য পরিবর্তিত হওয়ায় উজ্জ্বলতা প্রায় অপরিবর্তিত থাকে।",
      nisar: "নিয়মিত দেবে যাওয়ার মানচিত্র দিয়ে পরিচালনাকারী ও নিয়ন্ত্রক সংস্থা তেলকূপের পাইপলাইন ও কেসিংয়ের ঝুঁকি আগেভাগেই বুঝতে পারে।",
      look: "তেলক্ষেত্রের ওপর দিয়ে একটি প্রোফাইল রেখা টানুন এবং দেবে যাওয়া খাদটি দেখুন।",
    },
  },
  "sylhet-haor": {
    what: "Haors are bowl-shaped wetlands that flood every monsoon. In June 2022 extreme rain upstream in Meghalaya caused the worst floods in about a century.",
    radar: "Calm open water reflects the radar away and looks black. Flooded trees and wetlands glow bright where waves bounce off water and trunks.",
    nisar: "L-band penetrates forest canopy, so NISAR can map water hidden under the swamp forests that C-band misses.",
    look: "Play the whole year: the haors swell in the June 2022 floods, merge, then drain through the winter. Compare with Water history.",
    bn: {
      what: "হাওর হলো বাটি আকৃতির জলাভূমি যা প্রতি বর্ষায় প্লাবিত হয়। ২০২২ সালের জুনে মেঘালয়ের উজানে অতিবৃষ্টির কারণে প্রায় এক শতাব্দীর মধ্যে সবচেয়ে ভয়াবহ বন্যা দেখা দিয়েছিল।",
      radar: "শান্ত উন্মুক্ত পানি রাডার সংকেতকে বিপরীত দিকে প্রতিফলিত করে গাঢ় কালো দেখায়। নিমজ্জিত গাছপালা ও জলাভূমি উজ্জ্বল দেখায় কারণ ঢেউ পানি ও গাছের কাণ্ডে বাধা পেয়ে ফিরে আসে।",
      nisar: "এল-ব্যান্ড বনাঞ্চলের পাতার শামিয়ানা ভেদ করে, ফলে সেন্টিনেল-১ মিস করলেও নিসার জলাবনের নিচে লুকানো পানির নিখুঁত মানচিত্র তৈরি করতে পারে।",
      look: "পুরো বছরের টাইমলাইন চালান: ২০২২ সালের জুনের বন্যায় হাওরগুলো ফুলে ওঠে, একসাথে মিশে যায়, তারপর শীতজুড়ে পানি নেমে যায়। পানির ইতিহাসের (Water history) সাথে তুলনা করুন।",
    },
  },
  dhaka: {
    what: "Dhaka draws much of its water from aquifers beneath the city. As the clay layers dewater, the land slowly settles, raising flood risk in a city only a few metres above sea level.",
    radar: "InSAR detects millimetre-to-centimetre sinking over years. Buildings give stable, bright echoes, ideal for precise tracking.",
    nisar: "A free, regular sinking map for planners deciding where to switch from groundwater to river water.",
    look: "Draw an area over a neighbourhood and check the built-up exposure.",
    bn: {
      what: "ঢাকা শহর তার পানির প্রধান চাহিদা মেটায় ভূগর্ভস্থ জলাধার (অ্যাকুইফার) থেকে। মাটির কাদা স্তর শুকাতে থাকায় জমি ধীরে ধীরে দেবে যাচ্ছে, যা সমুদ্রপৃষ্ঠ থেকে মাত্র কয়েক মিটার উঁচুতে অবস্থিত এই মেগাসিটিতে বন্যার ঝুঁকি বহুগুণ বাড়াচ্ছে।",
      radar: "ইনসার বছরের পর বছর ধরে চলা মিলিমিটার থেকে সেন্টিমিটার স্কেলের মাটির অবনমন শনাক্ত করে। ভবনগুলো স্থায়ী, উজ্জ্বল সংকেত দেয় যা নিখুঁত পর্যবেক্ষণের জন্য আদর্শ।",
      nisar: "নগর পরিকল্পনাবিদদের জন্য একটি উন্মুক্ত ও নিয়মিত অবনমন মানচিত্র, যা ভূগর্ভস্থ পানি থেকে নদীর পানিতে সরে আসার নীতি নির্ধারণে সাহায্য করে।",
      look: "যেকোনো একটি এলাকার ওপর বৃত্ত বা চতুর্ভুজ আঁকুন এবং সেখানকার স্থাপনার ঘনত্ব ও মাটির গতিবিধি যাচাই করুন।",
    },
  },
  rangamati: {
    what: "Steep hills, heavy monsoon rain and cut slopes make landslides common. In June 2017 slides here killed over a hundred people.",
    radar: "Slopes often creep before they fail. A sudden brightness change can mark a fresh scar after a slide.",
    nisar: "Night and cloud do not stop NISAR, so it can survey slopes during the monsoon, when optical satellites are blind.",
    look: "Open the Motion layer and watch the slopes through the rains.",
    bn: {
      what: "খাড়া পাহাড়, ভারী মৌসুমি বৃষ্টি এবং পাহাড় কাটার কারণে এখানে প্রায়ই ভূমিধস হয়। ২০১৭ সালের জুনে ভূমিধসে শতাধিক মানুষের প্রাণহানি ঘটেছিল।",
      radar: "ধসে পড়ার আগে পাহাড়ের ঢাল প্রায়ই ধীরে ধীরে নড়াচড়া শুরু করে। ধসের পর তাজা ভাঙা অংশ হঠাৎ উজ্জ্বলতা পরিবর্তনের মাধ্যমে শনাক্ত হয়।",
      nisar: "রাত বা ঘন মেঘ কোনোটিই নিসারকে থামাতে পারে না, ফলে মৌসুমি বর্ষাকালে যখন সাধারণ অপটিক্যাল স্যাটেলাইট অকার্যকর থাকে, তখনও নিসার ঢাল পর্যবেক্ষণ করতে পারে।",
      look: "মোশন (Motion) লেয়ারটি খুলুন এবং বর্ষাজুড়ে ঢালগুলো কীভাবে নড়ে তা দেখুন।",
    },
  },
  kahramanmaras: {
    what: "On 6 February 2023 two great earthquakes (Mw 7.8 and 7.5) ruptured the East Anatolian Fault, destroying tens of thousands of buildings.",
    radar: "Collapsed buildings change how radar bounces back. At this map's 300 m scale, though, brightness alone barely separates rubble from spring fields; coherence between passes is the sharper damage signal.",
    nisar: "Rapid damage maps within days, plus fault-slip maps that show where stress moved next.",
    look: "Step across the red earthquake line on the timeline and switch to Change.",
    bn: {
      what: "২০২৩ সালের ৬ ফেব্রুয়ারি দুটি প্রলয়ঙ্করী ভূমিকম্প (Mw 7.8 এবং 7.5) পূর্ব আনাতোলিয়ান ফল্টরেখায় আঘাত হানে, যার ফলে হাজার হাজার ভবন ধসে পড়ে।",
      radar: "ধসে পড়া ভবনগুলোর রাডার প্রতিফলন নাটকীয়ভাবে পরিবর্তিত হয়। এই মানচিত্রের ৩০০ মিটার স্কেলে খালি চোখ দিয়ে ধ্বংসস্তূপ আলাদা করা কঠিন হলেও দুটি পাসের মধ্যবর্তী সুসংগততা হ্রাস (coherence loss) নিখুঁত ক্ষয়ক্ষতির সংকেত দেয়।",
      nisar: "কয়েক দিনের মধ্যে দ্রুত ক্ষয়ক্ষতি মানচিত্র এবং ফল্ট-স্লিপ মানচিত্র যা দেখায় ভূত্বকের চাপ পরবর্তী কোন এলাকায় স্থানান্তরিত হয়েছে।",
      look: "টাইমলাইনের লাল ভূমিকম্প রেখাটি অতিক্রম করুন এবং পরিবর্তন (Change) লেয়ারটিতে যান।",
    },
  },
  "campi-flegrei": {
    what: "This caldera under Pozzuoli has been rising since 2005, with uplift and small earthquakes speeding up recently as magma-driven fluids pressurise the ground.",
    radar: "InSAR shows a smooth dome of uplift centred on Pozzuoli. Each fringe is about 12 cm of motion toward the satellite.",
    nisar: "Frequent, precise uplift maps help civil protection judge whether unrest is speeding up.",
    look: "Open Fringes to see the bullseye around the town.",
    bn: {
      what: "পোজুওলির নিচে অবস্থিত এই ক্যালডেরা ২০০৫ সাল থেকে ধীরে ধীরে ফুলে উঠছে। সম্প্রতি ম্যাগমা-চালিত তরলের চাপে মাটির স্ফীতি ও ছোট ছোট ভূমিকম্প দ্রুততর হচ্ছে।",
      radar: "ইনসার পোজুওলিকে কেন্দ্র করে মাটির একটি মসৃণ স্ফীতির গম্বুজ প্রদর্শন করে। প্রতিটি ইন্টারফেরোগ্রাম ফ্রিঞ্জ স্যাটেলাইটের দিকে প্রায় ১২ সেমি গতি নির্দেশ করে।",
      nisar: "ঘন ঘন, নিখুঁত স্ফীতির মানচিত্র যা নাগরিক প্রতিরক্ষা সংস্থাকে বিচার করতে সাহায্য করে যে অগ্ন্যুৎপাতের প্রস্তুতি বাড়ছে কি না।",
      look: "ফ্রিঞ্জ (Fringes) লেয়ারটি খুলুন এবং শহরের চারপাশে চক্রাকার ফ্রিঞ্জ প্যাটার্নটি দেখুন।",
    },
  },
  "mexico-city": {
    what: "The city is built on old lakebed clay. Decades of groundwater pumping have made it one of the fastest-sinking cities on Earth, with tens of centimetres a year in places.",
    radar: "InSAR maps the sinking bowl. Its edges mark where buildings, metro lines and water pipes are being bent.",
    nisar: "Consistent long-term records to plan water supply and protect infrastructure.",
    look: "Draw a Profile from the centre to the hills.",
    bn: {
      what: "মেক্সিকো সিটি একটি প্রাচীন হ্রদের কাদার স্তরের ওপর নির্মিত। কয়েক দশক ধরে ভূগর্ভস্থ পানি তোলার কারণে এটি বিশ্বের দ্রুততম দেবে যাওয়া শহরগুলোর একটিতে পরিণত হয়েছে, কোনো কোনো স্থানে বছরে কয়েক দশ সেন্টিমিটার পর্যন্ত ভূমি দেবে যায়।",
      radar: "ইনসার পুরো অবনমন অববাহিকা মানচিত্রে ফুটিয়ে তোলে। এর প্রান্তগুলো নির্দেশ করে কোথায় ভবন, মেট্রো লাইন এবং পানির পাইপলাইন বেঁকে ভেঙে পড়ছে।",
      nisar: "পানি সরবরাহ পরিকল্পনা এবং গুরুত্বপূর্ণ অবকাঠামো রক্ষার জন্য নির্ভরযোগ্য দীর্ঘমেয়াদী রেকর্ড।",
      look: "শহরের কেন্দ্র থেকে পাহাড় পর্যন্ত একটি প্রোফাইল রেখা টানুন এবং দেবে যাওয়া অববাহিকাটি প্রত্যক্ষ করুন।",
    },
  },
  sindh: {
    what: "In 2022 record monsoon rains flooded about a third of Pakistan. Around Manchar Lake, embankments were cut to relieve pressure and floodwater sat for months.",
    radar: "Standing water is dark in VV, and Water history separates the usual lake from newly flooded farms and villages.",
    nisar: "All-weather flood maps every 12 days, plus soil moisture to tell when fields are dry enough to replant.",
    look: "Play from June 2022 into 2023 to watch the water spread and then slowly recede.",
    bn: {
      what: "২০২২ সালে রেকর্ড পরিমাণ মৌসুমি বৃষ্টিতে পাকিস্তানের প্রায় এক-তৃতীয়াংশ এলাকা প্লাবিত হয়। মাঞ্চার হ্রদের আশেপাশে চাপ কমাতে বাঁধ কেটে দেওয়া হয়েছিল এবং বন্যার পানি কয়েক মাস ধরে জমে ছিল।",
      radar: "স্থির পানি ভিভি (VV) রাডারে গাঢ় কালো দেখায়, এবং পানির ইতিহাস মানচিত্র স্বাভাবিক হ্রদ থেকে নতুন প্লাবিত কৃষি জমি ও গ্রামগুলোকে আলাদা করে।",
      nisar: "প্রতি ১২ দিনে সর্বাবস্থায় কার্যকর বন্যার মানচিত্র, সাথে মাটির আর্দ্রতা যা জানায় কখন জমি পুনরায় চাষের উপযুক্ত হবে।",
      look: "২০২২ সালের জুন থেকে ২০২৩ পর্যন্ত টাইমলাইন চালিয়ে দেখুন কীভাবে পানি ছড়িয়ে পড়ে এবং ধীরে ধীরে নেমে যায়।",
    },
  },
};
