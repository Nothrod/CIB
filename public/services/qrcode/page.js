const $ = id => document.getElementById(id);
let logo = "";
let current = null;
let revision = 0;
let fileRevision = 0;

function options() {
  return {
    width: 1000,
    height: 1000,
    type: "svg",
    data: $("data").value.trim(),
    margin: 80,
    image: logo,
    qrOptions: { errorCorrectionLevel: "H" },
    dotsOptions: {
      color: $("color").value,
      type: $("shape").value
    },
    backgroundOptions: { color: "#ffffff" },
    imageOptions: {
      imageSize: 0.25,
      margin: 10,
      saveAsBlob: true
    }
  };
}

async function refresh() {
  const version = ++revision;
  current = null;
  $("png").disabled = $("svg").disabled = true;
  $("qr").replaceChildren();

  if (!$("data").value.trim()) {
    $("status").textContent = "Saisissez un lien ou un texte.";
    return;
  }

  $("status").textContent = "Création du QR code…";
  try {
    const candidate = new QRCodeStyling(options());
    await candidate.getRawData("svg");
    if (version !== revision) return;
    candidate.append($("qr"));
    current = candidate;
    $("png").disabled = $("svg").disabled = false;
    $("status").textContent = "Votre QR code est prêt.";
  } catch {
    if (version !== revision) return;
    $("status").textContent =
      "Impossible de créer le QR code. Raccourcissez le texte ou retirez le logo.";
  }
}

["data", "color", "shape"].forEach(id => {
  $(id).addEventListener("input", refresh);
});

$("logo").addEventListener("change", async event => {
  const version = ++fileRevision;
  const file = event.target.files[0];
  if (!file) return;

  if (!["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 2 * 1024 * 1024) {
    event.target.value = "";
    $("status").textContent = "Choisissez un PNG ou JPG de 2 Mo maximum.";
    return;
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const testImage = new Image();
    testImage.src = result;
    await testImage.decode();
    if (version !== fileRevision) return;
    logo = result;
    await refresh();
  } catch {
    if (version !== fileRevision) return;
    $("status").textContent = "Cette image ne peut pas être ouverte.";
  }
});

$("remove").addEventListener("click", () => {
  ++fileRevision;
  logo = "";
  $("logo").value = "";
  refresh();
});

["png", "svg"].forEach(extension => {
  $(extension).addEventListener("click", async () => {
    if (!current) return;
    try {
      await current.download({ name: "mon-qr-code", extension });
    } catch {
      $("status").textContent = "Le téléchargement a échoué. Réessayez.";
    }
  });
});
