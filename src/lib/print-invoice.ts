import { api, formatINR, formatDate, formatDateTime } from '@/lib/hotel-utils'
import { billBalance, splitGst } from '@/lib/gst'
import { requestAdminApproval } from '@/lib/admin-pin'

export async function triggerPrintInvoice(bill: any, settings: Record<string, string> = {}) {
  if (!bill) return
  // A bill with balance due can only be printed with Admin approval
  const due = billBalance(bill)
  if (due > 0.01) {
    const ok = await requestAdminApproval(
      `Printed bill ${bill.billNumber || ''} with ₹${due.toFixed(2)} balance due`,
      `Bill ${bill.billNumber || ''} has ₹${due.toFixed(2)} balance due. Enter the Admin PIN to print it.`
    )
    if (!ok) return
  }

  const hotelName = settings.hotelName || 'Ashirbad Lodge'
  const hotelAddress = settings.hotelAddress || 'Station Road, Kolkata'
  const hotelPhone = settings.hotelPhone || '+91 90000 00000'
  const hotelGstin = settings.hotelGstin || ''

  // Date-wise history of every payment on this bill (advance, part payments, checkout, dues collected)
  let history: BillPaymentHistory | null = null
  if (bill.id) {
    try {
      history = await api<BillPaymentHistory>(`/api/bills?paymentsFor=${encodeURIComponent(bill.id)}`)
    } catch {
      history = null
    }
  }

  const guest = bill.booking?.guest
  const room = bill.booking?.room
  const roomNo = bill.roomNumber || room?.number || 'N/A'
  const roomDesc = bill.roomDescription || room?.type || ''
  const corporateName = bill.corporateName || guest?.company
  const gstNumber = bill.gstNumber || guest?.gst

  const subtotal = Math.max(0, (bill.billedRoomTotal || 0) + (bill.foodTotal || 0) + (bill.extraCharges || 0) - (bill.discount || 0))
  const gst = splitGst(bill)
  const previousDue = Number(bill.previousDue || 0)
  const guestAddress = guest?.address || ''
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
    .hist-title { margin-top: 18px; font-weight: 700; font-size: 13px; }
    .hist { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
    .hist th, .hist td { border-bottom: 1px solid #e5e7eb; padding: 5px 4px; text-align: left; }
    .hist th { background: #f9fafb; font-weight: 700; color: #374151; }
    .hist td.num, .hist th.num { text-align: right; white-space: nowrap; }
    .hist tfoot td { font-weight: 700; border-bottom: 0; }
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
        <div class="meta-row">Billing Room No: <span class="val">${escapeHtml(roomNo)} ${roomDesc ? `(${escapeHtml(roomDesc)})` : ''}</span></div>
        <div class="meta-row">Check-In: <span class="val">${formatDateTime(bill.booking?.checkIn)}</span></div>
        <div class="meta-row">Check-Out: <span class="val">${formatDateTime(bill.booking?.actualCheckOut || bill.booking?.checkOut)}</span></div>
        <div class="meta-row">Nights Billed: <span class="val">${bill.days} night(s)</span></div>
      </div>
      <div class="meta-col text-right">
        <div class="meta-row">Guest: <span class="val">${escapeHtml(guest?.name || 'Guest')}</span></div>
        <div class="meta-row">Phone: <span class="val">${escapeHtml(guest?.phone || 'N/A')}</span></div>
        ${guestAddress ? `<div class="meta-row">Address: <span class="val">${escapeHtml(guestAddress)}</span></div>` : ''}
        ${corporateName ? `<div class="meta-row">Company: <span class="val">${escapeHtml(corporateName)}</span></div>` : ''}
        ${gstNumber ? `<div class="meta-row">Company GSTIN: <span class="val">${escapeHtml(gstNumber)}</span></div>` : ''}
      </div>
    </div>

    <div class="divider"></div>

    <div class="table-section">
      <div class="row">
        <span>Room Rent — Room ${escapeHtml(roomNo)}${roomDesc ? ` (${escapeHtml(roomDesc)})` : ''}, ${bill.days} night${bill.days > 1 ? 's' : ''} @ ${formatINR(roomRatePerNight)}</span>
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

      <div class="row">
        <span>CGST (${gst.cgstPercent}%)</span>
        <span class="semi-bold">${formatINR(gst.cgst)}</span>
      </div>
      <div class="row">
        <span>SGST (${gst.sgstPercent}%)</span>
        <span class="semi-bold">${formatINR(gst.sgst)}</span>
      </div>

      ${previousDue > 0 ? `
      <div class="row red">
        <span>Previous Outstanding</span>
        <span class="semi-bold">${formatINR(previousDue)}</span>
      </div>` : ''}

      <div class="row total">
        <span>Grand Total</span>
        <span class="green">${formatINR(bill.grandTotal)}</span>
      </div>
    </div>

    ${history ? paymentHistoryHtml(history) : ''}


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

interface BillPaymentHistory {
  payments: { date: string; label: string; cash: number; upi: number; card: number; amount: number }[]
  totalPaid: number
  balance: number
}

function paymentModeText(p: { cash: number; upi: number; card: number }): string {
  const parts = [
    p.cash > 0 ? ['Cash', p.cash] : null,
    p.upi > 0 ? ['UPI', p.upi] : null,
    p.card > 0 ? ['Card', p.card] : null,
  ].filter(Boolean) as [string, number][]
  if (parts.length === 1) return parts[0][0]
  return parts.map(([mode, amount]) => `${mode} ${formatINR(amount)}`).join(' + ')
}

function paymentHistoryHtml(h: BillPaymentHistory): string {
  const rows = h.payments
    .map(
      (p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${formatDateTime(p.date)}</td>
          <td>${escapeHtml(p.label)}</td>
          <td>${escapeHtml(paymentModeText(p))}</td>
          <td class="num">${formatINR(p.amount)}</td>
        </tr>`
    )
    .join('')
  return `
    <div class="hist-title">Payment History</div>
    <table class="hist">
      <thead><tr><th>#</th><th>Date</th><th>Payment</th><th>Mode</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#6b7280">No payments recorded yet</td></tr>'}</tbody>
      <tfoot>
        <tr><td colspan="4">Total Paid</td><td class="num green">${formatINR(h.totalPaid)}</td></tr>
        <tr><td colspan="4">${h.balance > 0.01 ? 'Balance Due' : 'Status'}</td><td class="num ${h.balance > 0.01 ? 'red' : 'green'}">${h.balance > 0.01 ? formatINR(h.balance) : 'Fully Paid'}</td></tr>
      </tfoot>
    </table>`
}

export function triggerPrintFoodBill(order: any, settings: Record<string, string> = {}) {
  if (!order) return

  const restaurantName = settings.restaurantName || settings.hotelName || 'Ashirbad Restaurant'
  const restaurantAddress = settings.restaurantAddress || settings.hotelAddress || 'Station Road, Kolkata'
  const restaurantPhone = settings.restaurantPhone || settings.hotelPhone || '+91 90000 00000'
  const restaurantGstin = settings.restaurantGstin || settings.hotelGstin || ''
  const restaurantFssai = settings.restaurantFssai || ''

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
      <h2 style="font-size: 18px; margin-bottom: 2px;">${escapeHtml(restaurantName)}</h2>
      <p style="font-size: 11px; color: #4b5563;">${escapeHtml(restaurantAddress)} • Ph: ${escapeHtml(restaurantPhone)}</p>
      ${restaurantGstin ? `<p style="font-size: 11px; color: #4b5563; font-weight:600;">GSTIN: ${escapeHtml(restaurantGstin)}</p>` : ''}
      ${restaurantFssai ? `<p style="font-size: 11px; color: #4b5563; font-weight:600;">FSSAI Lic No: ${escapeHtml(restaurantFssai)}</p>` : ''}
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
    ${Number(order.taxAmount || 0) > 0 ? `
    <div class="flex-between" style="font-size:12px;"><span>Subtotal</span><span>${formatINR(order.subtotal || (order.total - order.taxAmount))}</span></div>
    <div class="flex-between" style="font-size:12px;"><span>CGST (${order.cgstPercent}%)</span><span>${formatINR(splitGst({ gstPercent: Number(order.cgstPercent || 0) + Number(order.sgstPercent || 0), cgstPercent: order.cgstPercent, sgstPercent: order.sgstPercent, actualGst: order.taxAmount }).cgst)}</span></div>
    <div class="flex-between" style="font-size:12px; margin-bottom:6px;"><span>SGST (${order.sgstPercent}%)</span><span>${formatINR(splitGst({ gstPercent: Number(order.cgstPercent || 0) + Number(order.sgstPercent || 0), cgstPercent: order.cgstPercent, sgstPercent: order.sgstPercent, actualGst: order.taxAmount }).sgst)}</span></div>
    ` : ''}
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

export function triggerPrintAdvanceReceipt(booking: any, settings: Record<string, string> = {}) {
  if (!booking) return

  const hotelName = settings.hotelName || 'Ashirbad Lodge'
  const hotelAddress = settings.hotelAddress || 'Station Road, Kolkata'
  const hotelPhone = settings.hotelPhone || '+91 90000 00000'
  const hotelGstin = settings.hotelGstin || ''

  const guest = booking.guest
  const room = booking.room
  const receiptNo = `ADV-${booking.id?.slice(-6).toUpperCase() || '1001'}`
  const stayTotal = (booking.ratePerDay || 0) * (booking.days || 1)
  const advance = booking.advance || 0
  const estBalance = Math.max(0, stayTotal - advance)

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Advance Booking Receipt ${receiptNo} - ${hotelName}</title>
  <style>
    @page { size: A4 portrait; margin: 0mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827; background: #ffffff; padding: 12mm 15mm; font-size: 13px; line-height: 1.5;
    }
    .receipt-card {
      max-width: 680px; margin: 0 auto; border: 1px solid #d1d5db; border-radius: 8px; padding: 24px;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    .hotel-name { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 2px; }
    .badge {
      display: inline-block; margin-top: 8px; padding: 4px 12px; font-size: 11px; font-weight: 700;
      border-radius: 9999px; background: #fef3c7; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .divider { border-top: 1px solid #e5e7eb; margin: 16px 0; }
    .meta-grid { display: flex; justify-content: space-between; gap: 20px; font-size: 12px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; color: #374151; }
    .row.advance { font-size: 16px; font-weight: 800; color: #047857; border-top: 2px solid #047857; padding-top: 10px; margin-top: 6px; }
    .note-box { background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 12px; margin-top: 16px; font-size: 11px; color: #92400e; }
  </style>
</head>
<body>
  <div class="receipt-card">
    <div class="text-center">
      <div class="hotel-name">${escapeHtml(hotelName)}</div>
      ${hotelAddress ? `<div style="font-size:12px; color:#4b5563;">${escapeHtml(hotelAddress)}</div>` : ''}
      ${hotelPhone ? `<div style="font-size:12px; color:#4b5563;">Ph: ${escapeHtml(hotelPhone)}</div>` : ''}
      ${hotelGstin ? `<div style="font-size:12px; font-weight:600; color:#374151;">GSTIN: ${escapeHtml(hotelGstin)}</div>` : ''}
      <div class="badge">ADVANCE BOOKING RECEIPT</div>
    </div>
    <div class="divider"></div>
    <div class="meta-grid">
      <div>
        <div>Receipt No: <span class="bold">${receiptNo}</span></div>
        <div>Date: <span class="bold">${booking.createdAt ? formatDateTime(booking.createdAt) : formatDateTime(new Date())}</span></div>
        <div>Room: <span class="bold">Room ${escapeHtml(room?.number || '—')}</span> (${escapeHtml(room?.type || '')})</div>
        <div>Stay: <span class="bold">${formatDate(booking.checkIn)} → ${formatDate(booking.checkOut)}</span> (${booking.days || 1} nights)</div>
      </div>
      <div class="text-right">
        <div>Guest: <span class="bold">${escapeHtml(guest?.name || 'Guest')}</span></div>
        <div>Phone: <span class="bold">${escapeHtml(guest?.phone || '—')}</span></div>
        ${guest?.company ? `<div>Company: <span class="bold">${escapeHtml(guest.company)}</span></div>` : ''}
        ${guest?.gst ? `<div>GSTIN: <span class="bold">${escapeHtml(guest.gst)}</span></div>` : ''}
      </div>
    </div>
    <div class="divider"></div>
    <div class="row">
      <span>Estimated Room Tariff (${booking.days || 1} night(s) @ ${formatINR(booking.ratePerDay)})</span>
      <span class="bold">${formatINR(stayTotal)}</span>
    </div>
    <div class="row advance">
      <span>Advance Payment Received</span>
      <span>${formatINR(advance)}</span>
    </div>
    <div class="row" style="color: #6b7280; font-size: 12px; padding-top: 4px;">
      <span>Estimated Balance on Checkout</span>
      <span class="bold">${formatINR(estBalance)}</span>
    </div>
    <div class="note-box">
      <b>Booking Confirmation Note:</b> This receipt confirms advance reservation payment. The remaining stay balance, along with any food orders or extra charges, will be settled upon checkout.
    </div>
    <p class="text-center" style="font-size: 11px; color: #6b7280; margin-top: 16px;">
      Thank you for choosing ${escapeHtml(hotelName)}! We look forward to hosting you.
    </p>
  </div>
</body>
</html>`

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

/**
 * Guest details sheet: profile with address and every stay with its original (actual) room number.
 * Money paid is deliberately not printed.
 */
export function triggerPrintGuestDetails(guest: any, settings: Record<string, string> = {}) {
  if (!guest) return
  const hotelName = settings.hotelName || 'Ashirbad Lodge'
  const hotelAddress = settings.hotelAddress || ''
  const hotelPhone = settings.hotelPhone || ''
  const stays = (guest.bookings || []) as any[]
  const rows = stays
    .map(
      (b) => `
      <tr>
        <td><b>${escapeHtml(b.room?.number || '—')}</b>${b.room?.type ? ` <span class="muted">(${escapeHtml(b.room.type)})</span>` : ''}</td>
        <td>${formatDate(b.checkIn)}</td>
        <td>${formatDate(b.actualCheckOut || b.checkOut)}</td>
        <td class="c">${b.days || 1}</td>
        <td class="c">${b.guestCount || 1}</td>
        <td>${escapeHtml(b.status || '')}</td>
        <td>${escapeHtml(b.bills?.[0]?.billNumber || '—')}</td>
      </tr>`
    )
    .join('')

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Guest Details - ${escapeHtml(guest.name || '')}</title>
  <style>
    @page { size: A4 portrait; margin: 0mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; padding: 12mm 15mm; font-size: 12px; line-height: 1.5; }
    .card { max-width: 720px; margin: 0 auto; border: 1px solid #d1d5db; border-radius: 8px; padding: 22px; }
    .c { text-align: center; }
    .muted { color: #6b7280; }
    h1 { font-size: 20px; font-weight: 800; }
    .badge { display: inline-block; margin-top: 6px; padding: 3px 12px; font-size: 11px; font-weight: 700; border-radius: 9999px; background: #ecfdf5; color: #065f46; letter-spacing: .5px; }
    .divider { border-top: 1px solid #e5e7eb; margin: 14px 0; }
    .grid { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; }
    .grid span:nth-child(odd) { color: #6b7280; }
    .grid span:nth-child(even) { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 4px; text-align: left; font-size: 11.5px; }
    th { background: #f9fafb; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <div class="c">
      <h1>${escapeHtml(hotelName)}</h1>
      ${hotelAddress ? `<div class="muted">${escapeHtml(hotelAddress)}</div>` : ''}
      ${hotelPhone ? `<div class="muted">Ph: ${escapeHtml(hotelPhone)}</div>` : ''}
      <div class="badge">GUEST DETAILS</div>
    </div>
    <div class="divider"></div>
    <div class="grid">
      <span>Guest Name</span><span>${escapeHtml(guest.name || '')}</span>
      <span>Phone</span><span>${escapeHtml(guest.phone || '')}</span>
      <span>Address</span><span>${escapeHtml(guest.address || '—')}</span>
      ${guest.company ? `<span>Company</span><span>${escapeHtml(guest.company)}</span>` : ''}
      ${guest.gst ? `<span>GSTIN</span><span>${escapeHtml(guest.gst)}</span>` : ''}
      ${guest.idProof ? `<span>ID Proof</span><span>${escapeHtml(guest.idProof)}</span>` : ''}
      <span>Total Stays</span><span>${stays.length}</span>
    </div>
    <div class="divider"></div>
    <div style="font-weight:700;">Stay History</div>
    <table>
      <thead><tr><th>Room No</th><th>Check-In</th><th>Check-Out</th><th class="c">Nights</th><th class="c">Guests</th><th>Status</th><th>Bill No</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="c muted">No stays recorded</td></tr>'}</tbody>
    </table>
    <p class="c muted" style="margin-top:16px; font-size:11px;">Printed ${formatDateTime(new Date())}</p>
  </div>
</body>
</html>`

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
    setTimeout(() => document.body.removeChild(iframe), 1000)
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
