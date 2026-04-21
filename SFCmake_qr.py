import pandas as pd
import qrcode
from tqdm import tqdm
from PIL import Image as PILImage, ImageDraw, ImageFont
import os

# Load Excel
df = pd.read_excel("SFC data.xlsx")

# Create folder for QR codes
os.makedirs("qrcodes", exist_ok=True)

# Set font for text below QR
try:
    font = ImageFont.truetype("arial.ttf", 20)  # Windows font
except:
    font = ImageFont.load_default()  # fallback

# Iterate with tqdm progress bar
for i, row in tqdm(df.iterrows(), total=len(df), desc="Generating QR Codes"):
    # Join all values into a plain string (tab separated) for QR content
    data = "\t".join([str(v) for v in row.values])

    first_name = str(row.iloc[2])
    last_name = str(row.iloc[1])
    full_name = f"{first_name} {last_name}"

    # Generate QR with lower error correction for maximum capacity
    qr_code = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_L,  # 7% error correction for max data capacity
        box_size=10,
        border=4,  # quiet zone
    )
    qr_code.add_data(data)
    qr_code.make(fit=True)
    qr_img = qr_code.make_image(fill='black', back_color='white').convert("RGB")

    # Draw text size
    draw = ImageDraw.Draw(qr_img)
    try:
        bbox = draw.textbbox((0, 0), full_name, font=font)
        text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except AttributeError:  # for older Pillow
        text_w, text_h = draw.textsize(full_name, font=font)

    # Create new image taller to fit text
    new_img = PILImage.new("RGB", (qr_img.width, qr_img.height + text_h + 10), "white")
    new_img.paste(qr_img, (0, 0))

    # Draw text centered
    draw = ImageDraw.Draw(new_img)
    draw.text(((qr_img.width - text_w) // 2, qr_img.height + 5), full_name, font=font, fill="black")

    # Save with full name as filename
    safe_name = full_name.replace(" ", "_")
    qr_path = f"qrcodes/{safe_name}.png"
    new_img.save(qr_path)

print(f"✅ Generated {len(df)} QR codes in 'qrcodes' folder!")
