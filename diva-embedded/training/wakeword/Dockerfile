FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3-pip \
    build-essential git curl wget \
    sox libsox-dev libsndfile1 \
    portaudio19-dev ffmpeg \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.10 /usr/bin/python3 && \
    ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /app

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# PyTorch CUDA 12.1
RUN pip install --no-cache-dir torch torchaudio \
    --index-url https://download.pytorch.org/whl/cu121

# Clone openWakeWord
RUN git clone --depth 1 https://github.com/dscripka/openWakeWord.git /app/deps/openWakeWord \
    && cd /app/deps/openWakeWord && pip install -e .

# Clone piper-sample-generator
RUN git clone --depth 1 https://github.com/rhasspy/piper-sample-generator.git /app/deps/piper-sample-generator

COPY scripts/ /app/scripts/
COPY config/ /app/config/

CMD ["bash"]
