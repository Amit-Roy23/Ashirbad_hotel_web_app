import { formatINR, formatDate, formatDateTime } from '@/lib/hotel-utils'

export function triggerPrintInvoice(bill: any, settings: Record<string, string> = {}) {
  if (!bill) return

  const hotelName = settings.hotelName || 'Ashirbad Lodge'
  const hotelAddress = settings.hotelAddress || 'Station Road, Kolkata'
  const hotelPhone = settings.hotelPhone || '+91 90000 00000'
  const hotelGstin = settings.hotelGstin || ''

  const guest = bill.booking?.guest
  const room = bill.booking?.room
  const roomNo = bill.roomNumber || room?.number || 'N/A'
  const roomDesc = bill.roomDescription || room?.type || ''
  const corporateName = bill.corporateName || guest?.company
  const gstNumber = bill.gstNumber || guest?.gst

  const subtotal = Math.max(0, (bill.billedRoomTotal || 0) + (bill.foodTotal || 0) + (bill.extraCharges || 0) - (bill.discount || 0))
  const paidAfterAdvance = (bill.payCash || 0) + (bill.payUpi || 0) + (bill.payCard || 0)
  const totalPaid = (bill.advanceApplied || 0) + paidAfterAdvance
  const balance = Math.max(0, Math.round(((bill.grandTotal || 0) - totalPaid) * 100) / 100)
  const roomRatePerNight = bill.days > 0 ? Math.round((bill.billedRoomTotal / bill.days) * 100) / 100 : bill.billedRoomTotal

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${bill.billNumber} - ${hotelName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background: #ffffff;
      padding: 12mm 15mm;
      font-size: 13px;
      line-height: 1.5;
    }
    .invoice-card {
      max-width: 680px;
      margin: 0 auto;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 24px;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    .semi-bold { font-weight: 600; }
    .hotel-name { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 2px; }
    .hotel-sub { font-size: 12px; color: #4b5563; margin-bottom: 2px; }
    .badge {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 9999px;
      background: #f3f4f6;
      color: #065f46;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .divider {
      border-top: 1px solid #e5e7eb;
      margin: 16px 0;
    }
    .meta-grid {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      font-size: 12px;
    }
    .meta-col { flex: 1; }
    .meta-row { margin-bottom: 4px; color: #374151; }
    .meta-row span.val { color: #111827; font-weight: 600; }
    .table-section { margin-top: 10px; }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 13px;
      color: #374151;
    }
    .row.total {
      font-size: 16px;
      font-weight: 800;
      color: #111827;
      border-top: 2px solid #111827;
      padding-top: 10px;
      margin-top: 6px;
    }
    .green { color: #047857; }
    .red { color: #dc2626; }
    .pay-box {
      margin-top: 16px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
    }
    .pay-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 3px;
      color: #4b5563;
    }
    .footer-note {
      margin-top: 24px;
      text-align: center;
      font-size: 11px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="text-center">
      <div class="hotel-name">${escapeHtml(hotelName)}</div>
      ${hotelAddress ? `<div class="hotel-sub">${escapeHtml(hotelAddress)}</div>` : ''}
      ${hotelPhone ? `<div class="hotel-sub">Ph: ${escapeHtml(hotelPhone)}</div>` : ''}
      ${hotelGstin ? `<div class="hotel-sub semi-bold">GSTIN: ${escapeHtml(hotelGstin)}</div>` : ''}
      <div class="badge">
        ${bill.actualGst > 0 ? 'GST TAX INVOICE' : 'NON-GST INVOICE / CASH MEMO'}
      </div>
    </div>

    <div class="divider"></div>

    <div class="meta-grid">
      <div class="meta-col">
        <div class="meta-row">Invoice No: <span class="val">${escapeHtml(bill.billNumber)}</span></div>
        <div class="meta-row">Date: <span class="val">${formatDateTime(bill.createdAt)}</span></div>
        <div class="meta-row">Room: <span class="val">${escapeHtml(roomNo)} ${roomDesc ? `(${escapeHtml(roomDesc)})` : ''}</span></div>
        <div class="meta-row">Stay: <span class="val">${bill.days} night(s) • ${formatDate(bill.booking?.checkIn)} → ${formatDate(bill.booking?.actualCheckOut || bill.booking?.checkOut)}</span></div>
      </div>
      <div class="meta-col text-right">
        <div class="meta-row">Guest: <span class="val">${escapeHtml(guest?.name || 'Guest')}</span></div>
        <div class="meta-row">Phone: <span class="val">${escapeHtml(guest?.phone || 'N/A')}</span></div>
        ${corporateName ? `<div class="meta-row">Company: <span class="val">${escapeHtml(corporateName)}</span></div>` : ''}
        ${gstNumber ? `<div class="meta-row">Guest GSTIN: <span class="val">${escapeHtml(gstNumber)}</span></div>` : ''}
      </div>
    </div>

    <div class="divider"></div>

    <div class="table-section">
      <div class="row">
        <span>${roomDesc ? `${escapeHtml(roomDesc)} ` : ''}Room Charge (${bill.days} night${bill.days > 1 ? 's' : ''} @ ${formatINR(roomRatePerNight)})</span>
        <span class="semi-bold">${formatINR(bill.billedRoomTotal)}</span>
      </div>

      ${bill.foodTotal > 0 ? `
      <div class="row">
        <span>Food / Restaurant Charges</span>
        <span class="semi-bold">${formatINR(bill.foodTotal)}</span>
      </div>` : ''}

      ${bill.extraCharges > 0 ? `
      <div class="row">
        <span>Extra Charges</span>
        <span class="semi-bold">${formatINR(bill.extraCharges)}</span>
      </div>` : ''}

      ${bill.discount > 0 ? `
      <div class="row green">
        <span>Discount</span>
        <span class="semi-bold">-${formatINR(bill.discount)}</span>
      </div>` : ''}

      <div class="row semi-bold">
        <span>Subtotal</span>
        <span>${formatINR(subtotal)}</span>
      </div>

      ${bill.actualGst > 0 ? `
      <div class="row">
        <span>GST (${bill.gstPercent}%)</span>
        <span class="semi-bold">${formatINR(bill.actualGst)}</span>
      </div>` : `
      <div class="row" style="color:#6b7280;">
        <span>GST (0%)</span>
        <span>₹0</span>
      </div>`}

      <div class="row total">
        <span>Grand Total</span>
        <span class="green">${formatINR(bill.grandTotal)}</span>
      </div>

      ${bill.advanceApplied > 0 ? `
      <div class="row green">
        <span>Less: Advance</span>
        <span class="semi-bold">-${formatINR(bill.advanceApplied)}</span>
      </div>` : ''}
    </div>

    <div class="pay-box">
      <div class="pay-row semi-bold" style="color:#111827;">
        <span>Paid (cash/UPI/card):</span><span>${formatINR(paidAfterAdvance)}</span>
      </div>
      ${bill.payCash > 0 ? `<div class="pay-row" style="padding-left:8px;"><span>• Cash</span><span>${formatINR(bill.payCash)}</span></div>` : ''}
      ${bill.payUpi > 0 ? `<div class="pay-row" style="padding-left:8px;"><span>• UPI</span><span>${formatINR(bill.payUpi)}</span></div>` : ''}
      ${bill.payCard > 0 ? `<div class="pay-row" style="padding-left:8px;"><span>• Card</span><span>${formatINR(bill.payCard)}</span></div>` : ''}
      <div class="pay-row semi-bold" style="border-top:1px solid #e5e7eb; padding-top:4px; margin-top:4px; color:#111827;">
        <span>Total Paid:</span><span>${formatINR(totalPaid)}</span>
      </div>
      ${balance > 0.01 ? `
      <div class="pay-row red bold">
        <span>Balance Due:</span><span>${formatINR(balance)}</span>
      </div>` : `
      <div class="pay-row green bold">
        <span>Balance Due:</span><span>₹0 (Fully Paid ✓)</span>
      </div>`}
    </div>

    <div class="footer-note">
      Thank you for staying with us! Please visit again.
    </div>
  </div>
</body>
</html>
  `

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) return

  doc.open()
  doc.write(html)
  doc.close()

  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => {
      document.body.removeChild(iframe)
    }, 1000)
  }, 300)
}

export function triggerPrintFoodBill(order: any, settings: Record<string, string> = {}) {
  if (!order) return

  const hotelName = settings.hotelName || 'Ashirbad Lodge'
  const hotelAddress = settings.hotelAddress || 'Station Road, Kolkata'
  const hotelPhone = settings.hotelPhone || '+91 90000 00000'

  const itemsHtml = (order.items || [])
    .map(
      (item: any) => `
    <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
      <span>${escapeHtml(item.name || 'Item')} x ${item.quantity || 1}</span>
      <span style="font-weight:600;">${formatINR(item.total || (item.price * (item.quantity || 1)))}</span>
    </div>
  `
    )
    .join('')

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Food Bill - ${order.id}</title>
  <style>
    @page { size: A4 portrait; margin: 0mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: sans-serif; padding: 12mm 15mm; font-size: 13px; color: #111827; }
    .bill-card { max-width: 480px; margin: 0 auto; border: 1px solid #d1d5db; padding: 20px; border-radius: 8px; }
    .text-center { text-align: center; }
    .divider { border-top: 1px solid #e5e7eb; margin: 12px 0; }
    .flex-between { display: flex; justify-content: space-between; }
    .bold { font-weight: 700; }
  </style>
</head>
<body>
  <div class="bill-card">
    <div class="text-center">
      <h2 style="font-size: 18px; margin-bottom: 2px;">${escapeHtml(hotelName)}</h2>
      <p style="font-size: 11px; color: #4b5563;">${escapeHtml(hotelAddress)} • Ph: ${escapeHtml(hotelPhone)}</p>
      <div style="margin-top:6px; font-weight:700; font-size:12px; letter-spacing:0.5px; color:#047857;">
        RESTAURANT & KITCHEN RECEIPT
      </div>
    </div>
    <div class="divider"></div>
    <div style="font-size: 12px; color:#374151;">
      <div class="flex-between"><span>Date:</span> <span class="bold">${formatDateTime(order.createdAt)}</span></div>
      ${order.room ? `<div class="flex-between"><span>Room No:</span> <span class="bold">Room ${escapeHtml(order.room.number)}</span></div>` : ''}
      ${order.guest ? `<div class="flex-between"><span>Guest:</span> <span class="bold">${escapeHtml(order.guest.name)}</span></div>` : ''}
    </div>
    <div class="divider"></div>
    <div>${itemsHtml}</div>
    <div class="divider"></div>
    <div class="flex-between bold" style="font-size: 15px;">
      <span>Total Amount</span>
      <span style="color: #047857;">${formatINR(order.total)}</span>
    </div>
    <div class="divider"></div>
    <p class="text-center" style="font-size: 11px; color: #6b7280;">Thank you for dining with us! Please visit again.</p>
  </div>
</body>
</html>
  `

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) return

  doc.open()
  doc.write(html)
  doc.close()

  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => {
      document.body.removeChild(iframe)
    }, 1000)
  }, 300)
}

function escapeHtml(str: string): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
