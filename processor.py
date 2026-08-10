#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import os
import re
from pathlib import Path

# محاولة استيراد المكتبات مع معالجة غيابها
try:
    import PyPDF2
except ImportError:
    PyPDF2 = None

try:
    from docx import Document
except ImportError:
    Document = None

try:
    import pytesseract
    from PIL import Image
except ImportError:
    pytesseract = None

def clean_text(text):
    if not text: return ""
    # تنظيف بسيط للنصوص
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def process_file(file_path):
    ext = Path(file_path).suffix.lower()
    text = ""
    
    try:
        if ext == '.pdf':
            if PyPDF2:
                with open(file_path, 'rb') as f:
                    reader = PyPDF2.PdfReader(f)
                    for page in reader.pages:
                        text += page.extract_text() or ""
            else:
                text = "[خطأ: مكتبة PyPDF2 غير مثبتة]"
        
        elif ext in ['.docx', '.doc']:
            if Document:
                doc = Document(file_path)
                text = "\n".join([p.text for p in doc.paragraphs])
            else:
                text = "[خطأ: مكتبة python-docx غير مثبتة]"
        
        elif ext in ['.jpg', '.jpeg', '.png']:
            if pytesseract:
                text = pytesseract.image_to_string(Image.open(file_path), lang='ara+eng')
            else:
                text = "[خطأ: مكتبة Tesseract غير مثبتة أو OCR غير متاح]"
        
        else:
            text = f"[صيغة غير مدعومة: {ext}]"
            
    except Exception as e:
        text = f"[خطأ أثناء المعالجة: {str(e)}]"
    
    return clean_text(text)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 processor.py <file_path>")
        sys.exit(1)
        
    file_path = sys.argv[1]
    result = process_file(file_path)
    
    # حفظ النتيجة في ملف نصي بجانب الملف الأصلي
    output_path = str(Path(file_path).with_suffix('_processed.txt'))
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("=== تقرير MMHR الذكي ===\n\n")
        f.write(result)
        
    print(result)
