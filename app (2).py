import webview
import os
import sys


def resource_path(relative_path):
    """Возвращает путь к файлам как в dev, так и в exe"""
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)


index_file = resource_path("index.html")


class Api:

    def save_json(self, data, filename_hint=None):

        # Имя файла по умолчанию — либо подсказка от фронта, либо tracker.json
        default_name = filename_hint or 'tracker.json'

        filename = webview.windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=default_name,
            file_types=('JSON (*.json)',)
        )

        if filename:
            with open(filename[0], 'w', encoding='utf-8') as f:
                f.write(data)

    def autosave(self, data):

        path = os.path.join(os.getcwd(), "autosave.json")

        with open(path, "w", encoding="utf-8") as f:
            f.write(data)

    def load_autosave(self):

        path = os.path.join(os.getcwd(), "autosave.json")

        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()

        return None

api = Api()

webview.create_window(
    "Call of Cthulhu Tracker",
    index_file,
    width=1600,
    height=900,
    resizable=True,
    js_api=api
)


webview.start()

