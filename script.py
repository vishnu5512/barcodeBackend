import os
import cv2
import pandas as pd
import numpy as np
from datetime import datetime
from pyzbar.pyzbar import decode
import fitz
import sys

class PDFBarcodeVerifier:
    def __init__(self):
        self.cancel_requested = False

    def pdf_to_images(self, pdf_path):
        images = []
        try:
            doc = fitz.open(pdf_path)
            for page in doc:
                pix = page.get_pixmap(dpi=200)
                img = np.frombuffer(pix.samples, dtype=np.uint8)
                img = img.reshape(pix.height, pix.width, pix.n)
                if pix.n == 4:
                    img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
                else:
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                images.append(img)
            return images
        except:
            return []

    def extract_barcode(self, image):
        try:
            h, w = image.shape[:2]
            top_area = image[0:int(h*0.35), :]
            bottom_area = image[int(h*0.65):h, :]
            areas = [top_area, bottom_area]

            for area in areas:
                gray = cv2.cvtColor(area, cv2.COLOR_BGR2GRAY)
                enhanced = cv2.convertScaleAbs(gray, alpha=1.7, beta=10)
                hist = cv2.equalizeHist(gray)
                _, thresh = cv2.threshold(gray,120,255,cv2.THRESH_BINARY)
                
                images_to_try = [gray, enhanced, hist, thresh]
                for img in images_to_try:
                    barcodes = decode(img)
                    if barcodes:
                        code = barcodes[0].data.decode("utf-8").strip()
                        if len(code) >= 6 and code.isalnum():
                            return code
            return None
        except:
            return None

    def process_folder(self, folder_path, expected_pages):
        pdf_files = [f for f in os.listdir(folder_path) if f.lower().endswith(".pdf")]

        if not pdf_files:
            print("ERROR: No PDF files found")
            return None

        total_files_global = len(pdf_files)
        print(f"TOTAL: {total_files_global}")

        results = []
        sr_no = 1
        processed_count_global = 0

        for pdf_file in pdf_files:
            if self.cancel_requested:
                print("STATUS: CANCELLED")
                break

            processed_count_global += 1

            pdf_path = os.path.join(folder_path, pdf_file)
            images = self.pdf_to_images(pdf_path)
            total_pages_found = len(images)

            if total_pages_found == 0:
                continue

            reference_barcode = self.extract_barcode(images[0])
            if reference_barcode is None:
                reference_barcode = self.extract_barcode(images[0])

            mismatch_pages = []
            mismatch_details = []
            missing_pages = []

            for i in range(0, total_pages_found, 2):
                page_number = i + 1
                barcode = self.extract_barcode(images[i])
                if barcode is None:
                    barcode = self.extract_barcode(images[i])

                if barcode and reference_barcode and barcode != reference_barcode:
                    mismatch_pages.append(str(page_number))
                    mismatch_details.append(f"Page {page_number}: {barcode}")

            expected_odd_pages = list(range(1, expected_pages + 1, 2))
            for page in expected_odd_pages:
                if page > total_pages_found:
                    missing_pages.append(str(page))

            if not mismatch_pages and not missing_pages:
                final_status = "VALID"
            elif missing_pages:
                final_status = "INVALID (Pages Count not Match)"
            elif mismatch_pages:
                final_status = "INVALID (Barcode Mismatch)"
            else:
                final_status = "INVALID"

            results.append({
                "Sr No": sr_no,
                "Folder Name": os.path.basename(folder_path),
                "File Name": pdf_file,
                "Total PDFs in Folder": total_files_global,
                "Expected Pages": expected_pages,
                "Total Pages Found": total_pages_found,
                "Reference Barcode": reference_barcode if reference_barcode else "-",
                "Mismatch Pages": ", ".join(mismatch_pages) if mismatch_pages else "-",
                "Mismatch Details": ", ".join(mismatch_details) if mismatch_details else "-",
                "Missing Pages Count": expected_pages - total_pages_found,
                "Final Status": final_status,
                "Processed Time": datetime.now().strftime("%d-%m-%Y %H:%M:%S")
            })

            sr_no += 1
            print(f"Processed: {pdf_file}")

        # If cancelled partway, results is still saved.
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = os.path.join(folder_path, f"barcode_report_{timestamp}.csv")
        df = pd.DataFrame(results)
        df.to_csv(output_file, index=False)
        print(f"Report: {output_file}")
        return output_file

if __name__ == "__main__":
    folder = sys.argv[1]
    pages = int(sys.argv[2])
    verifier = PDFBarcodeVerifier()
    verifier.process_folder(folder, pages)