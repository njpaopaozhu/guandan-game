'use strict';
// Local-only rendering: invitation capabilities never go to an external QR service.
function drawInviteQR(canvas, text) {
    const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
    const quiet = 4, scale = Math.max(3, Math.floor(280 / (qr.size + quiet * 2)));
    canvas.width = canvas.height = (qr.size + quiet * 2) * scale;
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++)
        if (qr.getModule(x, y)) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    canvas.hidden = false;
}
