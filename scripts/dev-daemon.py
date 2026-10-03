#!/usr/bin/env python3
"""Double-fork daemonize the Next.js dev server so it survives tool-session teardown."""
import os
import sys
import time

LOG = '/tmp/devserver.log'


def fork_and_exit():
    pid = os.fork()
    if pid > 0:
        os._exit(0)


fork_and_exit()
os.setsid()
fork_and_exit()

with open('/dev/null', 'rb') as devnull_in, open(LOG, 'ab', 0) as log_out:
    os.dup2(devnull_in.fileno(), 0)
    os.dup2(log_out.fileno(), 1)
    os.dup2(log_out.fileno(), 2)
    os.chdir('/home/z/my-project')
    env = dict(os.environ)
    env.setdefault('PORT', '3000')
    os.execvpe('bun', ['bun', 'run', 'dev'], env)
