// Cámara y lectura de códigos de barras.
// Usa el lector nativo del navegador cuando existe (Chrome en Android); si no (iPhone), usa ZXing,
// que se carga solo la primera vez que se abre el escáner.

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const SCAN_INTERVAL_MS = 120;

let zxingPromise;
function loadZXing() {
  zxingPromise ??= new Promise((resolve, reject) => {
    if (window.ZXing) { resolve(window.ZXing); return; }
    const script = document.createElement('script');
    script.src = new URL('./vendor/zxing.min.js', import.meta.url).href;
    script.onload = () => resolve(window.ZXing);
    script.onerror = () => {
      zxingPromise = null;
      reject(new Error('No se pudo cargar el lector de códigos.'));
    };
    document.head.append(script);
  });
  return zxingPromise;
}

async function nativeDecoder() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return null;
    const detector = new window.BarcodeDetector({ formats });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

async function zxingDecoder() {
  const ZXing = await loadZXing();
  const { BarcodeFormat, DecodeHintType } = ZXing;
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
    ]],
    [DecodeHintType.TRY_HARDER, true],
  ]));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const scale = Math.min(1, 800 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      return reader.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source))).getText();
    } catch {
      return null; // no hay código en este cuadro
    } finally {
      reader.reset();
    }
  };
}

// Abre la cámara en <video> y llama a onCode(texto) por cada código leído.
// Devuelve { stop(), torch } — torch es null si el teléfono no permite controlar la linterna.
export function createScanner(video, onCode) {
  let stream = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('Este navegador no permite usar la cámara.'), { name: 'NotSupportedError' });
    }
    const media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (stopped) { media.getTracks().forEach((t) => t.stop()); return null; }
    stream = media;
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const decode = (await nativeDecoder()) ?? (await zxingDecoder());

    const loop = async () => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const code = await decode(video).catch(() => null);
        if (stopped) return;
        if (code) onCode(code);
      }
      setTimeout(loop, SCAN_INTERVAL_MS);
    };
    loop();

    const track = stream.getVideoTracks()[0];
    const canTorch = !!track?.getCapabilities?.().torch;
    return canTorch ? (on) => track.applyConstraints({ advanced: [{ torch: on }] }) : null;
  };

  return { start, stop };
}

export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'No hay permiso para usar la cámara. Actívalo en los ajustes del teléfono o escribe el código abajo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró una cámara. Puedes escribir el código abajo.';
    case 'NotReadableError':
      return 'Otra app está usando la cámara. Ciérrala e intenta de nuevo.';
    default:
      return err?.message || 'No se pudo abrir la cámara.';
  }
}
