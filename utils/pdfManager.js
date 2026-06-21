/**
 * PDF compilation manager using jsPDF.
 * Implements strict A4 dimension scaling, multi-page layout wrapping,
 * 20px vertical spacing, and Tesseract OCR text embedding.
 */

// If running in Node/Electron environment, require jsPDF
let jsPDF;
if (typeof window === 'undefined') {
  // CommonJS require for Node server-side compilation
  const { jsPDF: jspdfLib } = require('jspdf');
  jsPDF = jspdfLib;
} else {
  // Use globally loaded jsPDF or imported ES6 in browser runtime
  jsPDF = window.jspdf ? window.jspdf.jsPDF : null;
}

/**
 * Compiles screenshots into a PDF document
 * @param {Array} screenshots - Array of screenshot objects: { id, dataUrl, name, width, height, ocrText, ocrWurds }
 * @param {Object} options - Custom parameters: filename, margin, spacing
 * @returns {Promise<String>} - Data URL or base64 stream of compiled PDF
 */
async function generateCompilationPDF(screenshots, options = {}) {
  const defaultOptions = {
    margin: 20, // Small margins matching requirements
    spacing: 20, // 20px spacing
    title: 'Screenshot Compilation'
  };
  const config = { ...defaultOptions, ...options };

  // If jsPDF is not bound, recover from window import safely
  if (!jsPDF && typeof window !== 'undefined' && window.jspdf) {
    jsPDF = window.jspdf.jsPDF;
  }

  if (!jsPDF) {
    throw new Error('jsPDF library is not loaded. Please ensure jspdf is installed/imported.');
  }

  // standard A4 dimensions in points (pt): 595.28 x 841.89 (approx 72 pt = 1 inch)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = config.margin;
  const spacing = config.spacing;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true
  });

  // Calculate printable dimensions
  const maxPrintWidth = pageWidth - 2 * margin;
  const maxPrintHeight = pageHeight - 2 * margin;

  let currentPage = 1;
  let currentY = margin;

  for (let i = 0; i < screenshots.length; i++) {
    const item = screenshots[i];
    
    // Deconstruct original dims or assign defaults
    let imgW = item.width || 800;
    let imgH = item.height || 600;
    
    // Scale image while preserving aspect ratio
    const scale = (item.scale || 100) / 100;
    const imgRatio = imgH / imgW;
    let scaledW = maxPrintWidth * scale;
    let scaledH = maxPrintWidth * imgRatio * scale;

    // Handle extremely tall screenshots: fit to max single page height
    if (scaledH > maxPrintHeight) {
      scaledH = maxPrintHeight;
      scaledW = scaledH / imgRatio;
    }

    // Determine position: Check if screenshot fits on current active page
    // Needs currentY + scaledH + margin inside A4 bounds
    if (i > 0 && currentY + scaledH + spacing > pageHeight - margin) {
      doc.addPage();
      currentPage++;
      currentY = margin;
    }

    const startX = margin + (maxPrintWidth - scaledW) / 2; // Horizontal center
    const startY = currentY;

    // Append standard image block
    try {
      doc.addImage(item.dataUrl, 'JPEG', startX, startY, scaledW, scaledH, undefined, 'FAST');
    } catch {
      try {
        // Fallback to generic block if JPEG compression headers are raw
        doc.addImage(item.dataUrl, 'PNG', startX, startY, scaledW, scaledH, undefined, 'FAST');
      } catch (err) {
        console.error('Failed to append image to PDF-Doc:', err);
      }
    }

    // Embed searchable OCR text transparently over the image block
    if (item.ocrEnabled !== false && item.ocrText && item.ocrText.trim().length > 0) {
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8);
      
      // We can write it in invisible text rendering mode (renderingMode 3)
      // to keep it native, clean, and selectable in standard PDF readers
      doc.setTextColor(255, 255, 255); // Match fallback or let reader query it
      
      // If we have precise coordinates from OCR, let's embed them. 
      // Safe fallback: append searchable line by line over the captured canvas zone
      const lines = item.ocrText.split('\n');
      let ocrY = startY + 15;
      
      lines.forEach((line) => {
        const cleanedStr = line.replace(/[^\x20-\x7E]/g, ''); // strip binary characters
        if (cleanedStr.trim().length > 0 && ocrY < startY + scaledH) {
          // jsPDF text call with transparent markup parameter or hidden layout
          doc.text(cleanedStr, startX + 10, ocrY, {
            renderingMode: 'invisible' // Native PDF invisible text mode
          });
          ocrY += 12; // Advance OCR font row line height
        }
      });
    }

    // Increment vertical offset for subsequent screenshot
    currentY = startY + scaledH + spacing;
  }

  // Return base64 or DataURL depending on execution mode
  return doc.output('datauristring');
}

// Module bonding: node compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateCompilationPDF };
} else {
  window.pdfManager = { generateCompilationPDF };
}
