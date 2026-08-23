#!/usr/bin/env python3
import sys
from PIL import Image
img = Image.open(sys.argv[1]).transpose(Image.FLIP_LEFT_RIGHT)
img.save(sys.argv[1])
