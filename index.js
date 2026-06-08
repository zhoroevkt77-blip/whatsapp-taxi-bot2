const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const ID_INSTANCE = process.env.ID_INSTANCE;
const API_TOKEN = process.env.API_TOKEN;
const BASE_URL = `https://api.green-api.com/waInstance${ID_INSTANCE}`;

// ─── REGIONS ───────────────────────────────────────────────
const regions = {
  "Баткен облусу": ["Баткен", "Кадамжай", "Лейлек (Раззаков)", "Кызыл-Кыя", "Сүлүктү"],
  "Жалал-Абад облусу": ["Манас", "Сузак", "Базар-Коргон", "Ноокен", "Кара-Көл", "Таш-Көмүр", "Майлуу-Суу", "Ала-Бука", "Аксы", "Чаткал", "Тогуз-Торо"],
  "Нарын облусу": ["Нарын", "Ат-Башы", "Ак-Талаа", "Жумгал", "Кочкор"],
  "Ош облусу": ["Ош", "Кара-Суу", "Араван", "Ноокат", "Өзгөн", "Кара-Кулжа", "Алай", "Чоң-Алай"],
  "Талас облусу": ["Талас", "Бакай-Ата", "Кара-Буура", "Манас району"],
  "Чүй облусу": ["Жайыл", "Токмок", "Кемин"],
  "Ысык-Көл облусу": ["Каракол", "Балыкчы", "Чолпон-Ата", "Түп", "Ак-Суу", "Жети-Өгүз", "Тоң"],
};
const regionList = Object.keys(regions);

// ─── IN-MEMORY STORAGE ─────────────────────────────────────
// drivers list (persists while server runs)
const drivers = [];

// user session state: { [chatId]: { state, data } }
const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) sessions[chatId] = { state: null, data: {} };
  return sessions[chatId];
}

function resetSession(chatId) {
  sessions[chatId] = { state: null, data: {} };
}

// ─── SEND MESSAGE ───────────────────────────────────────────
async function sendMessage(chatId, text) {
  try {
    await axios.post(`${BASE_URL}/sendMessage/${API_TOKEN}`, {
      chatId,
      message: text,
    });
  } catch (e) {
    console.error("sendMessage error:", e.message);
  }
}

// ─── MENUS ─────────────────────────────────────────────────
const MAIN_MENU = `🚕 *Такси Бот KG — Кош келиңиз!*

Тандаңыз:
*1* — 🚗 Айдоочумун
*2* — 🧍 Жүргүнчүмүн`;

function regionsMenu() {
  let lines = ["Облус тандаңыз (номер жазыңыз):\n"];
  regionList.forEach((name, i) => lines.push(`${i + 1}. ${name}`));
  return lines.join("\n");
}

function citiesMenu(regionName) {
  const cities = regions[regionName] || [];
  let lines = [`📍 *${regionName}*\nШаар тандаңыз (номер жазыңыз):\n`];
  cities.forEach((city, i) => lines.push(`${i + 1}. ${city}`));
  return lines.join("\n");
}

// ─── SEARCH DRIVERS ────────────────────────────────────────
function searchDrivers(region, direction) {
  const cities = regions[region] || [];
  const found = direction === "toBishkek"
    ? drivers.filter(d => cities.includes(d.from_city) && d.to_city === "Бишкек")
    : drivers.filter(d => d.from_city === "Бишкек" && cities.includes(d.to_city));

  const label = direction === "toBishkek"
    ? `${region} → Бишкек`
    : `Бишкек → ${region}`;

  if (!found.length) {
    return [`📍 *${label}*\n\nАзырынча айдоочу табылган жок.\nКийинчерээк кайра текшериңиз.`];
  }

  const msgs = [`📍 *${label}*\n✅ ${found.length} айдоочу табылды`];

  const grouped = {};
  found.forEach(d => {
    const key = direction === "toBishkek" ? d.from_city : d.to_city;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  });

  Object.entries(grouped).forEach(([city, list]) => {
    msgs.push(`📌 *${city}* — ${list.length} айдоочу`);
    list.forEach(r => {
      let card = `🚗 *АЙДООЧУ*\n\n`;
      card += `👤 Аты: ${r.name}\n`;
      card += `🚙 Машина: ${r.car}\n`;
      card += `🗺 Маршрут: ${r.from_city} → ${r.to_city}\n`;
      card += `🕐 Убакыт: ${r.time}\n`;
      card += `💰 Баа: ${r.price} сом\n`;
      card += `💺 Орун: ${r.seats}\n`;
      card += `📞 Тел: ${r.phone}\n`;
      if (r.whatsapp && r.whatsapp !== r.phone) {
        card += `💬 WA: ${r.whatsapp}\n`;
      } else if (r.whatsapp) {
        card += `💬 WhatsApp: бар\n`;
      }
      card += `📝 Комментарий: ${r.comment || "-"}`;
      msgs.push(card);
    });
  });

  return msgs;
}

// ─── PROCESS MESSAGE ───────────────────────────────────────
async function processMessage(chatId, text) {
  const lower = text.trim().toLowerCase();
  const sess = getSession(chatId);

  // Reset commands
  if (["старт", "start", "баштоо", "меню", "menu", "/start", "1", "2"].includes(lower) && !sess.state) {
    // fall through to main menu handler below
  }

  if (["старт", "start", "баштоо", "меню", "menu", "/start"].includes(lower)) {
    resetSession(chatId);
    await sendMessage(chatId, MAIN_MENU);
    return;
  }

  const { state } = sess;

  // ── MAIN MENU ──
  if (!state) {
    if (text === "1") {
      sess.state = "d_name";
      await sendMessage(chatId, "👤 Атыңызды жазыңыз:");
    } else if (text === "2") {
      sess.state = "p_route";
      await sendMessage(chatId, "Маршрут тандаңыз:\n*1* — Бишкекке барам\n*2* — Бишкектен кетем");
    } else {
      await sendMessage(chatId, MAIN_MENU);
    }
    return;
  }

  // ── DRIVER FLOW ──
  if (state.startsWith("d_")) {
    await handleDriver(chatId, text, sess);
    return;
  }

  // ── PASSENGER FLOW ──
  if (state.startsWith("p_")) {
    await handlePassenger(chatId, text, sess);
    return;
  }
}

async function handleDriver(chatId, text, sess) {
  const { state, data } = sess;

  if (state === "d_name") {
    data.name = text;
    sess.state = "d_car";
    await sendMessage(chatId, "🚙 Машинаңыздын маркасы жана модели:");

  } else if (state === "d_car") {
    data.car = text;
    sess.state = "d_route";
    await sendMessage(chatId, "Маршрут тандаңыз:\n*1* — Бишкекке барам\n*2* — Бишкектен кетем");

  } else if (state === "d_route") {
    if (text === "1") {
      data.to = "Бишкек";
      sess.state = "d_from_region";
      await sendMessage(chatId, regionsMenu());
    } else if (text === "2") {
      data.from = "Бишкек";
      sess.state = "d_to_region";
      await sendMessage(chatId, regionsMenu());
    } else {
      await sendMessage(chatId, "1 же 2 жазыңыз.");
    }

  } else if (state === "d_from_region") {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= regionList.length) {
      await sendMessage(chatId, "⚠️ Туура номер жазыңыз.");
      return;
    }
    data._region = regionList[idx];
    sess.state = "d_from_city";
    await sendMessage(chatId, citiesMenu(data._region));

  } else if (state === "d_from_city") {
    const cities = regions[data._region] || [];
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= cities.length) {
      await sendMessage(chatId, "⚠️ Туура номер жазыңыз.");
      return;
    }
    data.from = cities[idx];
    sess.state = "d_time";
    await sendMessage(chatId, "🕐 Жолго чыгуу убактысы (мисалы: 06:00):");

  } else if (state === "d_to_region") {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= regionList.length) {
      await sendMessage(chatId, "⚠️ Туура номер жазыңыз.");
      return;
    }
    data._region = regionList[idx];
    sess.state = "d_to_city";
    await sendMessage(chatId, citiesMenu(data._region));

  } else if (state === "d_to_city") {
    const cities = regions[data._region] || [];
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= cities.length) {
      await sendMessage(chatId, "⚠️ Туура номер жазыңыз.");
      return;
    }
    data.to = cities[idx];
    sess.state = "d_time";
    await sendMessage(chatId, "🕐 Жолго чыгуу убактысы (мисалы: 06:00):");

  } else if (state === "d_time") {
    data.time = text;
    sess.state = "d_price";
    await sendMessage(chatId, "💰 Жол кире акы (сом):");

  } else if (state === "d_price") {
    data.price = text;
    sess.state = "d_seats";
    await sendMessage(chatId, "💺 Бош орун саны (1-7):");

  } else if (state === "d_seats") {
    data.seats = text;
    sess.state = "d_phone";
    await sendMessage(chatId, "📞 Телефон номериңиз:");

  } else if (state === "d_phone") {
    data.phone = text;
    sess.state = "d_whatsapp";
    await sendMessage(chatId, "💬 WhatsApp номериңиз барбы?\n*1* — Ооба (телефон менен бирдей)\n*2* — Ооба (башка номер)\n*3* — Жок");

  } else if (state === "d_whatsapp") {
    if (text === "1") {
      data.whatsapp = data.phone;
      sess.state = "d_comment";
      await sendMessage(chatId, "📝 Комментарий (болбосо чызыкча коюңуз -):");
    } else if (text === "2") {
      sess.state = "d_whatsapp_num";
      await sendMessage(chatId, "💬 WhatsApp номериңизди жазыңыз:");
    } else {
      data.whatsapp = null;
      sess.state = "d_comment";
      await sendMessage(chatId, "📝 Комментарий (болбосо чызыкча коюңуз -):");
    }

  } else if (state === "d_whatsapp_num") {
    data.whatsapp = text;
    sess.state = "d_comment";
    await sendMessage(chatId, "📝 Комментарий (болбосо чызыкча коюңуз -):");

  } else if (state === "d_comment") {
    data.comment = text;

    const required = ["name", "car", "from", "to", "time", "price", "phone", "seats"];
    const missing = required.find(f => !data[f]);
    if (missing) {
      await sendMessage(chatId, "⚠️ Маалымат жетишсиз. Кайрадан баштаңыз.");
      resetSession(chatId);
      await sendMessage(chatId, MAIN_MENU);
      return;
    }

    const newDriver = {
      name: data.name,
      car: data.car,
      from_city: data.from,
      to_city: data.to,
      time: data.time,
      price: data.price,
      phone: data.phone,
      whatsapp: data.whatsapp || null,
      seats: data.seats,
      comment: data.comment || "-",
    };
    drivers.push(newDriver);

    let card = `✅ *Маалыматыңыз жазылды!*\n\n`;
    card += `🚗 *АЙДООЧУ*\n\n`;
    card += `👤 Аты: ${newDriver.name}\n`;
    card += `🚙 Машина: ${newDriver.car}\n`;
    card += `🗺 Маршрут: ${newDriver.from_city} → ${newDriver.to_city}\n`;
    card += `🕐 Убакыт: ${newDriver.time}\n`;
    card += `💰 Баа: ${newDriver.price} сом\n`;
    card += `💺 Орун: ${newDriver.seats}\n`;
    card += `📞 Тел: ${newDriver.phone}\n`;
    if (newDriver.whatsapp && newDriver.whatsapp !== newDriver.phone) {
      card += `💬 WA: ${newDriver.whatsapp}\n`;
    } else if (newDriver.whatsapp) {
      card += `💬 WhatsApp: бар\n`;
    }
    card += `📝 Комментарий: ${newDriver.comment}`;

    resetSession(chatId);
    await sendMessage(chatId, card);
    await sendMessage(chatId, MAIN_MENU);
  }
}

async function handlePassenger(chatId, text, sess) {
  const { state } = sess;

  if (state === "p_route") {
    if (text === "1") {
      sess.state = "p_to_region";
      await sendMessage(chatId, regionsMenu());
    } else if (text === "2") {
      sess.state = "p_from_region";
      await sendMessage(chatId, regionsMenu());
    } else {
      await sendMessage(chatId, "1 же 2 жазыңыз.");
    }

  } else if (state === "p_to_region") {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= regionList.length) {
      await sendMessage(chatId, "⚠️ Туура номер жазыңыз.");
      return;
    }
    const region = regionList[idx];
    const results = searchDrivers(region, "toBishkek");
    resetSession(chatId);
    for (const msg of results) {
      await sendMessage(chatId, msg);
    }
    await sendMessage(chatId, MAIN_MENU);

  } else if (state === "p_from_region") {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= regionList.length) {
      await sendMessage(chatId, "⚠️ Туура номер жазыңыз.");
      return;
    }
    const region = regionList[idx];
    const results = searchDrivers(region, "fromBishkek");
    resetSession(chatId);
    for (const msg of results) {
      await sendMessage(chatId, msg);
    }
    await sendMessage(chatId, MAIN_MENU);
  }
}

// ─── WEBHOOK ───────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // always ack fast

  try {
    const body = req.body;

    // Only handle incoming text messages
    if (body.typeWebhook !== "incomingMessageReceived") return;
    if (!body.messageData || body.messageData.typeMessage !== "textMessage") return;

    const chatId = body.senderData?.chatId;
    const text = body.messageData?.textMessageData?.textMessage?.trim();

    if (!chatId || !text) return;

    console.log(`[${chatId}] ${text}`);
    await processMessage(chatId, text);
  } catch (e) {
    console.error("Webhook error:", e.message);
  }
});

// Health check
app.get("/", (req, res) => res.send("Такси Бот иштеп жатат ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
