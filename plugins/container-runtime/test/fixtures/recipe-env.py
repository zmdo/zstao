"""Remote OS/process boundaries for the real recipe; never invoke host package tools."""
import json
import os
import pwd
import grp
import subprocess
from types import SimpleNamespace

path = os.environ["SMP_RECIPE_TEST_STATE"]


def load():
    with open(path) as stream:
        return json.load(stream)


def save(state):
    with open(path, "w") as stream:
        json.dump(state, stream)


def account(name):
    user = load()["users"][name]
    return SimpleNamespace(pw_name=name, pw_uid=user["uid"], pw_gid=user["gid"])


def by_uid(uid):
    return account(next(name for name, user in load()["users"].items() if user["uid"] == uid))


def group(name):
    # The SSH user may have sudoers permission without a sudo group at all.
    assert name == "docker", "must not enumerate administrator groups"
    state = load()
    if not state["groupExists"]:
        raise KeyError(name)
    return SimpleNamespace(gr_gid=988, gr_mem=state["members"])


os.geteuid = lambda: load()["uid"]
pwd.getpwuid = by_uid
pwd.getpwnam = account
grp.getgrnam = group
os.getgrouplist = lambda name, gid: [gid] + ([988] if name in load()["members"] else [])


def run(args, **kwargs):
    state = load()
    state["commands"].append(args)
    command = args[2:] if args[:2] == ["sudo", "-n"] else args
    name = command[0]
    code, out, err = 0, "", ""
    if name == "dpkg-query":
        version = state["installed"].get(command[-1])
        if version:
            out = "install ok installed\t" + version + "\tamd64"
        else:
            code = 1
    elif name == "docker":
        package = "docker-compose-v2" if command[1] == "compose" else "docker.io"
        version = state["installed"].get(package)
        if version:
            out = version.split("-")[0]
        else:
            code = 1
    elif name == "sh" and command[1:] == ["-c", "command -v docker"]:
        code = 0 if "docker.io" in state["installed"] else 1
    elif name == "apt-cache" and command[1] == "show":
        package, version = command[2].split("=")
        out = "\n".join([
            "Package: " + package, "Version: " + version, "Architecture: amd64",
            "Filename: pool/" + package + ".deb", "SHA256: " + "a" * 64,
        ])
    elif name == "apt-get" and "--simulate" in command:
        package, version = command[-1].split("=")
        out = "Inst " + package + " (" + version + " repo [amd64])\nConf " + package + "\n"
    elif name == "apt-get" and "--yes" in command:
        for item in command[command.index("install") + 1:]:
            package, version = item.split("=")
            state["installed"][package] = version
        state["groupExists"] = True
    elif name == "usermod":
        assert command[1:5] == ["-aG", "docker", "--", command[-1]]
        if state.get("groupFailure"):
            code, err = 1, "usermod: cannot lock /etc/group"
        elif not state.get("groupNoop"):
            state["members"].append(command[-1])
    else:
        raise AssertionError("Unexpected command: " + repr(args))
    save(state)
    if not kwargs.get("text"):
        out, err = out.encode(), err.encode()
    return subprocess.CompletedProcess(args, code, out, err)


subprocess.run = run
