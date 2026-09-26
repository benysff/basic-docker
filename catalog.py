"""Hazır parça kataloğu: tek tıkla kurulabilen popüler servisler.

Değerlerdeki yer tutucular kurulum sırasında doldurulur:
  {sifre} -> otomatik üretilen güçlü şifre
  {db}    -> uygulama adından türetilen veritabanı adı
"""

CATALOG = [
    {
        "id": "postgres",
        "title": "PostgreSQL",
        "tagline": "Veritabanı",
        "kind": "db",
        "desc": "Uygulamanın bilgilerini (kullanıcılar, siparişler, yazılar…) kalıcı olarak saklar. "
                "Çoğu proje için ilk tercih.",
        "image": "postgres:17-alpine",
        "role": "postgres",
        "ports": [{"container": 5432, "label": "Veritabanı kapısı"}],
        "env": {"POSTGRES_USER": "app", "POSTGRES_PASSWORD": "{sifre}", "POSTGRES_DB": "{db}"},
        "data": "/var/lib/postgresql/data",
    },
    {
        "id": "mysql",
        "title": "MySQL",
        "tagline": "Veritabanı",
        "kind": "db",
        "desc": "Klasik ve çok yaygın veritabanı. WordPress, Laravel gibi projeler genelde bunu ister.",
        "image": "mysql:8.4",
        "role": "mysql",
        "ports": [{"container": 3306, "label": "Veritabanı kapısı"}],
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
        "kind": "db",
        "desc": "Bilgileri tablo yerine JSON benzeri belgeler olarak saklar. Node.js projelerinde sık kullanılır.",
        "image": "mongo:8",
        "role": "mongo",
        "ports": [{"container": 27017, "label": "Veritabanı kapısı"}],
        "env": {"MONGO_INITDB_ROOT_USERNAME": "app", "MONGO_INITDB_ROOT_PASSWORD": "{sifre}"},
        "data": "/data/db",
    },
    {
        "id": "redis",
        "title": "Redis",
        "tagline": "Hızlı hafıza / önbellek",
        "kind": "cache",
        "desc": "Sık kullanılan bilgileri hafızada tutar; oturumlar, önbellek ve iş kuyrukları için birebir.",
        "image": "redis:7-alpine",
        "role": "redis",
        "ports": [{"container": 6379, "label": "Redis kapısı"}],
        "env": {},
        "cmd": ["redis-server", "--appendonly", "yes"],
        "data": "/data",
    },
    {
        "id": "mailpit",
        "title": "Mailpit",
        "tagline": "Test e-posta kutusu",
        "kind": "mail",
        "desc": "Uygulamanın gönderdiği e-postaları yakalar, gerçek kişilere gitmez. "
                "Gelen kutusunu tarayıcıdan görürsün.",
        "image": "axllent/mailpit:latest",
        "role": "mailpit",
        "ports": [
            {"container": 8025, "label": "Gelen kutusu (tarayıcı)", "web": True},
            {"container": 1025, "label": "SMTP (uygulaman mailleri buraya gönderir)"},
        ],
        "env": {},
    },
    {
        "id": "adminer",
        "title": "Adminer",
        "tagline": "Veritabanı paneli",
        "kind": "panel",
        "desc": "Veritabanındaki tabloları tarayıcıdan görüp düzenlemeni sağlar. "
                "Aynı uygulamadaki veritabanına bağlanmak için sunucu kısmına parça adını yaz (ör. postgres).",
        "image": "adminer:latest",
        "role": "adminer",
        "ports": [{"container": 8080, "label": "Panel (tarayıcı)", "web": True}],
        "env": {},
    },
    {
        "id": "minio",
        "title": "MinIO",
        "tagline": "Dosya deposu (S3)",
        "kind": "storage",
        "desc": "Yüklenen dosyaları (resim, belge, video) saklar. Amazon S3'ün bilgisayarındaki kopyası gibi.",
        "image": "minio/minio:latest",
        "role": "minio",
        "ports": [
            {"container": 9000, "label": "S3 kapısı (kodun buraya bağlanır)"},
            {"container": 9001, "label": "Yönetim paneli (tarayıcı)", "web": True},
        ],
        "env": {"MINIO_ROOT_USER": "app", "MINIO_ROOT_PASSWORD": "{sifre}"},
        "cmd": ["server", "/data", "--console-address", ":9001"],
        "data": "/data",
    },
    {
        "id": "rabbitmq",
        "title": "RabbitMQ",
        "tagline": "Mesaj kuyruğu",
        "kind": "queue",
        "desc": "Parçalar arasında iş/mesaj taşır. Bir parça iş bırakır, diğeri sırayla alıp yapar.",
        "image": "rabbitmq:4-management-alpine",
        "role": "rabbitmq",
        "ports": [
            {"container": 5672, "label": "Kuyruk kapısı"},
            {"container": 15672, "label": "Yönetim paneli (tarayıcı)", "web": True},
        ],
        "env": {"RABBITMQ_DEFAULT_USER": "app", "RABBITMQ_DEFAULT_PASS": "{sifre}"},
        "data": "/var/lib/rabbitmq",
    },
    {
        "id": "meilisearch",
        "title": "Meilisearch",
        "tagline": "Arama motoru",
        "kind": "search",
        "desc": "Sitene hızlı ve yazım hatasını affeden bir arama kutusu eklemek için.",
        "image": "getmeili/meilisearch:latest",
        "role": "meilisearch",
        "ports": [{"container": 7700, "label": "Arama kapısı / panel", "web": True}],
        "env": {"MEILI_MASTER_KEY": "{sifre}", "MEILI_ENV": "development"},
        "data": "/meili_data",
    },
    {
        "id": "n8n",
        "title": "n8n",
        "tagline": "Otomasyon aracı",
        "kind": "app",
        "desc": "Zapier benzeri, sürükle-bırak ile otomasyon kurarsın (form gelince mail at, tabloya yaz…).",
        "image": "n8nio/n8n:latest",
        "role": "n8n",
        "ports": [{"container": 5678, "label": "Panel (tarayıcı)", "web": True}],
        "env": {"GENERIC_TIMEZONE": "Europe/Istanbul", "N8N_SECURE_COOKIE": "false"},
        "data": "/home/node/.n8n",
    },
]

BY_ID = {item["id"]: item for item in CATALOG}


def public_catalog():
    """Arayüze gönderilecek sade liste (şifre şablonları gibi iç ayrıntılar hariç)."""
    return [
        {
            "id": t["id"],
            "title": t["title"],
            "tagline": t["tagline"],
            "kind": t["kind"],
            "desc": t["desc"],
            "image": t["image"],
            "role": t["role"],
            "ports": [p["label"] for p in t["ports"]],
            "has_data": bool(t.get("data")),
            "has_password": any("{sifre}" in v for v in t["env"].values()),
        }
        for t in CATALOG
    ]
