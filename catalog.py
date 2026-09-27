"""Hazır parça kataloğu: tek tıkla kurulabilen popüler servisler.

Değerlerdeki yer tutucular kurulum sırasında doldurulur:
  {sifre} -> otomatik üretilen güçlü şifre
  {db}    -> uygulama adından türetilen veritabanı adı

Metinlerin İngilizcesi `_en` ile biten alanlarda durur.
"""

CATALOG = [
    {
        "id": "postgres",
        "title": "PostgreSQL",
        "tagline": "Veritabanı",
        "tagline_en": "Database",
        "kind": "db",
        "desc": "Uygulamanın bilgilerini (kullanıcılar, siparişler, yazılar…) kalıcı olarak saklar. "
                "Çoğu proje için ilk tercih.",
        "desc_en": "Stores your app's data (users, orders, posts…) permanently. The first choice for most projects.",
        "image": "postgres:17-alpine",
        "role": "postgres",
        "ports": [{"container": 5432, "label": "Veritabanı kapısı", "label_en": "Database port"}],
        "env": {"POSTGRES_USER": "app", "POSTGRES_PASSWORD": "{sifre}", "POSTGRES_DB": "{db}"},
        "data": "/var/lib/postgresql/data",
    },
    {
        "id": "mysql",
        "title": "MySQL",
        "tagline": "Veritabanı",
        "tagline_en": "Database",
        "kind": "db",
        "desc": "Klasik ve çok yaygın veritabanı. WordPress, Laravel gibi projeler genelde bunu ister.",
        "desc_en": "The classic, very common database. Projects like WordPress and Laravel usually expect it.",
        "image": "mysql:8.4",
        "role": "mysql",
        "ports": [{"container": 3306, "label": "Veritabanı kapısı", "label_en": "Database port"}],
        "env": {
            "MYSQL_ROOT_PASSWORD": "{sifre}",
            "MYSQL_DATABASE": "{db}",
            "MYSQL_USER": "app",
            "MYSQL_PASSWORD": "{sifre}",
        },
        "data": "/var/lib/mysql",
    },
    {
        "id": "mongo",
        "title": "MongoDB",
        "tagline": "Veritabanı (belge tipi)",
        "tagline_en": "Database (documents)",
        "kind": "db",
        "desc": "Bilgileri tablo yerine JSON benzeri belgeler olarak saklar. Node.js projelerinde sık kullanılır.",
        "desc_en": "Stores data as JSON-like documents instead of tables. Common in Node.js projects.",
        "image": "mongo:8",
        "role": "mongo",
        "ports": [{"container": 27017, "label": "Veritabanı kapısı", "label_en": "Database port"}],
        "env": {"MONGO_INITDB_ROOT_USERNAME": "app", "MONGO_INITDB_ROOT_PASSWORD": "{sifre}"},
        "data": "/data/db",
    },
    {
        "id": "redis",
        "title": "Redis",
        "tagline": "Hızlı hafıza / önbellek",
        "tagline_en": "In-memory store / cache",
        "kind": "cache",
        "desc": "Sık kullanılan bilgileri hafızada tutar; oturumlar, önbellek ve iş kuyrukları için birebir.",
        "desc_en": "Keeps frequently used data in memory; perfect for sessions, caching and job queues.",
        "image": "redis:7-alpine",
        "role": "redis",
        "ports": [{"container": 6379, "label": "Redis kapısı", "label_en": "Redis port"}],
        "env": {},
        "cmd": ["redis-server", "--appendonly", "yes"],
        "data": "/data",
    },
    {
        "id": "mailpit",
        "title": "Mailpit",
        "tagline": "Test e-posta kutusu",
        "tagline_en": "Test mailbox",
        "kind": "mail",
        "desc": "Uygulamanın gönderdiği e-postaları yakalar, gerçek kişilere gitmez. "
                "Gelen kutusunu tarayıcıdan görürsün.",
        "desc_en": "Catches the e-mails your app sends so they never reach real people. "
                   "You read the inbox in your browser.",
        "image": "axllent/mailpit:latest",
        "role": "mailpit",
        "ports": [
            {"container": 8025, "label": "Gelen kutusu (tarayıcı)", "label_en": "Inbox (browser)", "web": True},
            {"container": 1025, "label": "SMTP (uygulaman mailleri buraya gönderir)",
             "label_en": "SMTP (your app sends mail here)"},
        ],
        "env": {},
    },
    {
        "id": "adminer",
        "title": "Adminer",
        "tagline": "Veritabanı paneli",
        "tagline_en": "Database admin panel",
        "kind": "panel",
        "desc": "Veritabanındaki tabloları tarayıcıdan görüp düzenlemeni sağlar. "
                "Aynı uygulamadaki veritabanına bağlanmak için sunucu kısmına parça adını yaz (ör. postgres).",
        "desc_en": "Lets you browse and edit database tables in your browser. To connect to a database in the "
                   "same app, type the container name as the server (e.g. postgres).",
        "image": "adminer:latest",
        "role": "adminer",
        "ports": [{"container": 8080, "label": "Panel (tarayıcı)", "label_en": "Panel (browser)", "web": True}],
        "env": {},
    },
    {
        "id": "minio",
        "title": "MinIO",
        "tagline": "Dosya deposu (S3)",
        "tagline_en": "File storage (S3)",
        "kind": "storage",
        "desc": "Yüklenen dosyaları (resim, belge, video) saklar. Amazon S3'ün bilgisayarındaki kopyası gibi.",
        "desc_en": "Stores uploaded files (images, documents, videos). Like a local copy of Amazon S3.",
        "image": "minio/minio:latest",
        "role": "minio",
        "ports": [
            {"container": 9000, "label": "S3 kapısı (kodun buraya bağlanır)", "label_en": "S3 port (your code connects here)"},
            {"container": 9001, "label": "Yönetim paneli (tarayıcı)", "label_en": "Admin panel (browser)", "web": True},
        ],
        "env": {"MINIO_ROOT_USER": "app", "MINIO_ROOT_PASSWORD": "{sifre}"},
        "cmd": ["server", "/data", "--console-address", ":9001"],
        "data": "/data",
    },
    {
        "id": "rabbitmq",
        "title": "RabbitMQ",
        "tagline": "Mesaj kuyruğu",
        "tagline_en": "Message queue",
        "kind": "queue",
        "desc": "Parçalar arasında iş/mesaj taşır. Bir parça iş bırakır, diğeri sırayla alıp yapar.",
        "desc_en": "Carries jobs/messages between parts. One drops work off, another picks it up in order.",
        "image": "rabbitmq:4-management-alpine",
        "role": "rabbitmq",
        "ports": [
            {"container": 5672, "label": "Kuyruk kapısı", "label_en": "Queue port"},
            {"container": 15672, "label": "Yönetim paneli (tarayıcı)", "label_en": "Admin panel (browser)", "web": True},
        ],
        "env": {"RABBITMQ_DEFAULT_USER": "app", "RABBITMQ_DEFAULT_PASS": "{sifre}"},
        "data": "/var/lib/rabbitmq",
    },
    {
        "id": "meilisearch",
        "title": "Meilisearch",
        "tagline": "Arama motoru",
        "tagline_en": "Search engine",
        "kind": "search",
        "desc": "Sitene hızlı ve yazım hatasını affeden bir arama kutusu eklemek için.",
        "desc_en": "Adds a fast, typo-tolerant search box to your site.",
        "image": "getmeili/meilisearch:latest",
        "role": "meilisearch",
        "ports": [{"container": 7700, "label": "Arama kapısı / panel", "label_en": "Search port / panel", "web": True}],
        "env": {"MEILI_MASTER_KEY": "{sifre}", "MEILI_ENV": "development"},
        "data": "/meili_data",
    },
    {
        "id": "n8n",
        "title": "n8n",
        "tagline": "Otomasyon aracı",
        "tagline_en": "Automation tool",
        "kind": "app",
        "desc": "Zapier benzeri, sürükle-bırak ile otomasyon kurarsın (form gelince mail at, tabloya yaz…).",
        "desc_en": "Zapier-like drag-and-drop automations (send a mail when a form comes in, write to a sheet…).",
        "image": "n8nio/n8n:latest",
        "role": "n8n",
        "ports": [{"container": 5678, "label": "Panel (tarayıcı)", "label_en": "Panel (browser)", "web": True}],
        "env": {"GENERIC_TIMEZONE": "Europe/Istanbul", "N8N_SECURE_COOKIE": "false"},
        "data": "/home/node/.n8n",
    },
]

BY_ID = {item["id"]: item for item in CATALOG}


def _lang():
    import docker_service  # geç içe aktarma: docker_service de bu modülü içe aktarıyor
    return docker_service.LANG


def _pick(item, field):
    return item.get(f"{field}_en") or item[field] if _lang() == "en" else item[field]


def port_label(port):
    return _pick(port, "label")


def public_catalog():
    """Arayüze gönderilecek sade liste (şifre şablonları gibi iç ayrıntılar hariç)."""
    return [
        {
            "id": t["id"],
            "title": t["title"],
            "tagline": _pick(t, "tagline"),
            "kind": t["kind"],
            "desc": _pick(t, "desc"),
            "image": t["image"],
            "role": t["role"],
            "ports": [port_label(p) for p in t["ports"]],
            "has_data": bool(t.get("data")),
            "has_password": any("{sifre}" in v for v in t["env"].values()),
        }
        for t in CATALOG
    ]
