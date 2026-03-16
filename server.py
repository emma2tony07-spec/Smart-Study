import json
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs
import cgi
from io import BytesIO
import urllib.request

# -----------------------------
# CONFIGURATION (HARD-CODED)
# -----------------------------
OPENROUTER_API_KEY = "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"  # <-- Replace with your key
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
YOUR_SITE_URL = "http://localhost:5000"
YOUR_APP_NAME = "SmartStudy"

if not OPENROUTER_API_KEY:
    raise Exception("OpenRouter API key is missing.")

# -----------------------------
# PDF EXTRACTION HELPER
# -----------------------------
def extract_text_from_pdf(pdf_bytes):
    """
    Extract text from a PDF file using PyPDF2 (pypdf).
    If PyPDF2 is not installed, raise an ImportError with instructions.
    """
    try:
        import PyPDF2  # or try: import pypdf as PyPDF2
    except ImportError:
        raise ImportError("PyPDF2 is required to process PDF files. Install it with: pip install PyPDF2")

    try:
        pdf_reader = PyPDF2.PdfReader(BytesIO(pdf_bytes))
        text = ""
        for page in pdf_reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        if not text.strip():
            raise ValueError("No text could be extracted from the PDF.")
        return text
    except Exception as e:
        raise ValueError(f"Failed to extract text from PDF: {str(e)}")

# -----------------------------
# HELPER FUNCTIONS
# -----------------------------

def call_openrouter(messages):
    """Call OpenRouter API with given messages and return JSON-decoded response."""
    data = json.dumps({
        "model": "nvidia/nemotron-3-nano-30b-a3b:free",  # Free model for testing
        "messages": messages,
        "temperature": 0.7,
        "response_format": {"type": "json_object"}
    }).encode("utf-8")

    req = urllib.request.Request(OPENROUTER_API_URL, data=data)
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {OPENROUTER_API_KEY}")
    req.add_header("HTTP-Referer", YOUR_SITE_URL)
    req.add_header("X-Title", YOUR_APP_NAME)

    with urllib.request.urlopen(req, timeout=60) as response:
        result = json.loads(response.read().decode())
        content = result["choices"][0]["message"]["content"]
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # Fallback: wrap plain content
            return {"summary": content, "questions": ["Could not parse questions."]}

def detect_chapters(text):
    """Ask AI to detect chapters and return structured JSON."""
    messages = [
        {"role": "system", "content": (
            "You are an expert document analyzer. "
            "Detect logical chapter boundaries. "
            "Return strictly JSON in format: { 'chapters': [ { 'title': string, 'content': string } ] } "
            "Do not summarize the content, only structure chapters."
        )},
        {"role": "user", "content": text[:20000]}
    ]
    return call_openrouter(messages)

def summarize_chapter(text):
    """Ask AI to summarize a single chapter and generate practice questions."""
    messages = [
        {"role": "system", "content": (
            "You are an expert tutor. Provide a concise summary and 3 practice questions with answers. "
            "Return JSON: { 'summary': string, 'questions': array of strings }"
        )},
        {"role": "user", "content": text[:15000]}
    ]
    return call_openrouter(messages)

def grade_answer(chapter_text, student_answer):
    """Ask AI to grade the student's answer for a chapter."""
    messages = [
        {"role": "system", "content": (
            "You are a strict but fair academic evaluator. "
            "Evaluate the student's answer based on the chapter content. "
            "Return JSON: { 'feedback': string, 'score': integer 0-10 }"
        )},
        {"role": "user", "content": f"Chapter Content:\n{chapter_text[:15000]}\n\nStudent Answer:\n{student_answer}"}
    ]
    return call_openrouter(messages)

def get_text_from_upload(file_item):
    """
    Read the uploaded file and return its text content.
    If it's a PDF (based on filename or MIME type), extract text.
    Otherwise, decode as UTF-8 text.
    """
    filename = file_item.filename or ""
    content_type = file_item.type or ""

    # Read raw bytes
    file_bytes = file_item.file.read()

    # Check if it's a PDF
    is_pdf = filename.lower().endswith('.pdf') or content_type == 'application/pdf'

    if is_pdf:
        return extract_text_from_pdf(file_bytes)
    else:
        # Assume plain text
        try:
            return file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("Uploaded file is not a valid UTF-8 text file and not a PDF.")

# -----------------------------
# REQUEST HANDLER
# -----------------------------

class Handler(BaseHTTPRequestHandler):

    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers()

    def do_POST(self):
        try:
            # parse multipart form
            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "Content-Type must be multipart/form-data"}).encode())
                return

            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type}
            )

            # -----------------------------
            # /analyze → detect chapters
            # -----------------------------
            if self.path == "/analyze":
                file_item = form["file"]
                text = get_text_from_upload(file_item)
                result = detect_chapters(text)
                self._set_headers()
                self.wfile.write(json.dumps(result).encode())

            # -----------------------------
            # /summarize → summarize chapter
            # -----------------------------
            elif self.path == "/summarize":
                file_item = form["file"]
                text = get_text_from_upload(file_item)
                result = summarize_chapter(text)
                self._set_headers()
                self.wfile.write(json.dumps(result).encode())

            # -----------------------------
            # /grade → grade student's answer
            # -----------------------------
            elif self.path == "/grade":
                chapter_text = form.getvalue("chapter_text")
                answer = form.getvalue("answer")
                result = grade_answer(chapter_text, answer)
                self._set_headers()
                self.wfile.write(json.dumps(result).encode())

            else:
                self._set_headers(404)
                self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode())

        except ImportError as ie:
            # Missing PDF library
            self._set_headers(500)
            self.wfile.write(json.dumps({"error": str(ie)}).encode())
        except Exception as e:
            traceback.print_exc()
            self._set_headers(500)
            self.wfile.write(json.dumps({"error": str(e)}).encode())

# -----------------------------
# SERVER ENTRY
# -----------------------------

def run_server(port=5000):
    server_address = ("", port)
    httpd = HTTPServer(server_address, Handler)
    print(f"Server running on http://localhost:{port}")
    print("Press Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")

if __name__ == "__main__":
    run_server()