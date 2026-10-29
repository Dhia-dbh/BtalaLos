import sys

import pymupdf


def merge(output, sources):
    with pymupdf.open() as bundle:
        for filename in sources:
            with pymupdf.open(filename) as document:
                if document.needs_pass:
                    raise ValueError("Password-protected PDFs cannot be bundled.")
                bundle.insert_pdf(document, links=True, annots=True, widgets=True)
        bundle.save(output, garbage=4, deflate=True)


if __name__ == "__main__":
    merge(sys.argv[1], sys.argv[2:])
