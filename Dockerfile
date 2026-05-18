# Use a imagem base oficial leve do Python
FROM python:3.10-slim

# Evita que o Python grave arquivos .pyc no disco
ENV PYTHONDONTWRITEBYTECODE=1
# Evita que o Python coloque em buffer as saídas stdout e stderr
ENV PYTHONUNBUFFERED=1

# Define o diretório de trabalho no container
WORKDIR /app

# Instala dependências do sistema necessárias para o Django e rede
# IMPORTANTE: O pacote 'iputils-ping' é essencial para que o comando 'ping' funcione dentro do container Linux!
RUN apt-get update && apt-get install -y --no-install-recommends \
    iputils-ping \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copia os arquivos de dependência do Python
COPY requirements.txt /app/

# Instala as dependências do Python
RUN pip install --no-cache-dir -r requirements.txt

# Copia todo o restante do código do projeto para o container
COPY . /app/

# Porta onde o Django vai rodar
EXPOSE 8000

# Executa as migrações do banco e inicializa o servidor de monitoramento do Django
CMD ["sh", "-c", "python manage.py migrate && python manage.py runserver 0.0.0.0:8000"]
