from PIL import Image
import base64

# Open original photo
img = Image.open("student.jpg")

# Resize to 64x64
img = img.resize((72,72))

# Save compressed JPEG
img.save("small.jpg", format="JPEG", quality=10)



with open("small.jpg", "rb") as img:
    base64_text = base64.b64encode(img.read()).decode()

# Save text
with open("image.txt", "w") as f:
    f.write(base64_text)