from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


OUTPUT = Path(__file__).with_name("reader-e2e-sample.pdf")
PAGE_WIDTH, PAGE_HEIGHT = A4

pdfmetrics.registerFont(TTFont("DejaVuSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSerif", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"))

SECTIONS = [
    (
        "A Local-First Reading Workflow",
        "A compact sample paper for testing document import, selectable text, reading progress, translation highlights, notes, and portable study records.",
    ),
    (
        "1. Reading with Intent",
        "Deep reading is not only the act of moving through pages. It is a cycle of noticing, questioning, translating, annotating, and returning to the evidence. A calm reader interface should preserve that cycle without hiding the document behind tools.",
    ),
    (
        "2. Local-First Data",
        "A local-first application stores the source document and study records on the reader's own device. Only text that the reader explicitly selects for translation should leave the browser session. This boundary is simple enough to understand and strict enough to trust.",
    ),
    (
        "3. Translation as Memory",
        "Translation is most useful when it becomes durable context. Reusing a cached translation avoids duplicate requests, while a visible blue marker makes the result easy to revisit. Vocabulary cards turn isolated lookups into material for deliberate review.",
    ),
    (
        "4. Notes That Travel",
        "Annotations gain value when they can move between devices and people. Stable document fingerprints and normalized page coordinates let a shared notes bundle recover the right page and position without including the original PDF.",
    ),
    (
        "5. Conclusion",
        "The best reading tool feels quiet during reading and precise when the reader asks for help. Continuous scrolling supports papers, a two-page book view supports long-form reading, and persistent local records connect both modes.",
    ),
]


def draw_wrapped_text(pdf: canvas.Canvas, text: str, x: float, y: float, width: float) -> float:
    words = text.split()
    line = ""
    line_height = 20
    for word in words:
        candidate = f"{line} {word}".strip()
        if pdf.stringWidth(candidate, "DejaVuSerif", 12) <= width:
            line = candidate
            continue
        pdf.drawString(x, y, line)
        line = word
        y -= line_height
    if line:
        pdf.drawString(x, y, line)
    return y - line_height


def create_sample() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    pdf.setTitle("Local-First Reading Workflow")
    pdf.setAuthor("Modu Reader QA")

    for page_number, (heading, body) in enumerate(SECTIONS, start=1):
        destination = f"page-{page_number}"
        pdf.bookmarkPage(destination)
        pdf.addOutlineEntry(heading, destination, level=0)

        pdf.setFillColor(HexColor("#0F2747"))
        pdf.rect(0, PAGE_HEIGHT - 78, PAGE_WIDTH, 78, stroke=0, fill=1)
        pdf.setFillColor(HexColor("#FFFFFF"))
        pdf.setFont("DejaVuSans-Bold", 10)
        pdf.drawString(48, PAGE_HEIGHT - 48, "MODU READER - TEST DOCUMENT")

        pdf.setFillColor(HexColor("#17365D"))
        pdf.setFont("DejaVuSans-Bold", 24 if page_number == 1 else 21)
        pdf.drawString(58, PAGE_HEIGHT - 145, heading)

        pdf.setStrokeColor(HexColor("#8AAEE8"))
        pdf.setLineWidth(2)
        pdf.line(58, PAGE_HEIGHT - 164, 178, PAGE_HEIGHT - 164)

        pdf.setFillColor(HexColor("#2C3E50"))
        pdf.setFont("DejaVuSerif", 12)
        body_y = draw_wrapped_text(pdf, body, 58, PAGE_HEIGHT - 205, PAGE_WIDTH - 116)

        pdf.setFillColor(HexColor("#F3F6FA"))
        pdf.roundRect(58, body_y - 118, PAGE_WIDTH - 116, 92, 6, stroke=0, fill=1)
        pdf.setFillColor(HexColor("#315B8C"))
        pdf.setFont("DejaVuSans-Bold", 10)
        pdf.drawString(76, body_y - 53, "READER CHECK")
        pdf.setFillColor(HexColor("#40546B"))
        pdf.setFont("DejaVuSerif", 11)
        check_text = "Select this sentence to test translation, then add a note and revisit the saved marker."
        draw_wrapped_text(pdf, check_text, 76, body_y - 76, PAGE_WIDTH - 152)

        pdf.setStrokeColor(HexColor("#D7DFE8"))
        pdf.setLineWidth(0.6)
        pdf.line(58, 58, PAGE_WIDTH - 58, 58)
        pdf.setFillColor(HexColor("#6D7C8D"))
        pdf.setFont("DejaVuSans", 9)
        pdf.drawString(58, 39, "Local document - safe for automated browser tests")
        pdf.drawRightString(PAGE_WIDTH - 58, 39, f"{page_number} / {len(SECTIONS)}")
        pdf.showPage()

    pdf.save()


if __name__ == "__main__":
    create_sample()
