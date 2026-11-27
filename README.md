# ROTA FİNANS — konut kredisi oranları

Bankaların kendi herkese açık sayfalarından günde 3 kez okunan konut kredisi
oranları (`data/rates.json`). ROTA FİNANS vadeli satış hesaplayıcısı bu dosyayı
kullanır. Müşteri bilgisi içermez.

- Yalnızca bankaların kendi siteleri; robots.txt ve erişim kısıtlamalarına uyulur.
- Her oran kaynak bağlantısı ve okunma zamanıyla birlikte saklanır.
- Okunamayan banka için önceki oran, ilk okunma zamanıyla en fazla 72 saat taşınır.
