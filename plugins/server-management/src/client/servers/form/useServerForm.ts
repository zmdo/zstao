import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { GroupDto } from '../../../shared/dto/groups.ts'
import type { KeyDto } from '../../../shared/dto/keys.ts'
import type { ServerDto } from '../../../shared/dto/servers.ts'
import {
  defaultTypeForOs,
  sameSoftware,
  typeSupportsOs,
  type ServerTypeView,
  type TypeOptions,
} from '../../../shared/definitions.ts'
import { ServerError } from '../../../shared/errors.ts'
import { serverCopy } from '../../../shared/i18n.ts'
import { OS_CATALOG, sameDeclaredOs, supportsOs, type DeclaredOs } from '../../../shared/operating-systems.ts'
import type { SoftwarePolicy } from '../../../shared/policies.ts'
import { api, requestError } from '../../shared/api.ts'
import { EnrollmentPreview, type ConnectionResult } from './enrollment-preview.ts'
export interface ServerFormProps {
  active: string
  editing: boolean
  serverId: string
  initialGroupId: string
  /** The workspace config panel overrides the create/edit heading. */
  title?: string
  /** The workspace sidebar already provides the return entry. */
  embedded?: boolean
  onDone: (id: string) => void
  onSaved?: (server: ServerDto) => void
  onCancel: () => void
}

export function useServerForm(props: ServerFormProps) {
  const { active } = props
  const copy = serverCopy(active).ui
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [user, setUser] = useState('')
  const [method, setMethod] = useState('private_key')
  const [keyId, setKeyId] = useState('')
  const [keyName, setKeyName] = useState('')
  const [secret, setSecret] = useState('')
  const [groupId, setGroupId] = useState(props.initialGroupId)
  const [typeKey, setTypeKey] = useState('')
  const [savedType, setSavedType] = useState<ServerTypeView | undefined>()
  const [original, setOriginal] = useState<{ groupId: string; typeKey: string } | undefined>()
  const [osFamily, setOsFamily] = useState('')
  const [osRelease, setOsRelease] = useState('')
  const [osText, setOsText] = useState('')
  const [savedOs, setSavedOs] = useState<DeclaredOs | undefined>()
  const [region, setRegion] = useState('')
  const [auto, setAuto] = useState(false)
  const [groups, setGroups] = useState<GroupDto[]>([])
  const [keys, setKeys] = useState<KeyDto[]>([])
  const [defaults, setDefaults] = useState<TypeOptions | undefined>()
  const [serverLoaded, setServerLoaded] = useState(!props.editing)
  const [error, setError] = useState<ServerError | null>(null)
  const [connection, setConnection] = useState<(ConnectionResult & { revision: number }) | undefined>()
  const [loadedServer, setLoadedServer] = useState<ServerDto | undefined>()
  const [pending, setPending] = useState<'test' | 'identify' | null>(null)
  const [previews] = useState(() => new EnrollmentPreview())
  const [cachedIdentification, setCachedIdentification] = useState(false)
  const automaticIdentification = useRef<string | undefined>(undefined)
  const requests = useRef(0)
  const authRevision = useRef({ key: '', revision: 0 })
  const identityRevision = useRef({ key: '', revision: 0 })

  function applyServer(server: ServerDto, options: { basic?: boolean; policies?: boolean } = {}): void {
    setLoadedServer(server)
    if (options.policies !== false) {
      setPolicies(server.software_policies)
      setAuto(server.install_required_software)
    }
    if (options.basic !== false) {
      setName(server.name)
      setHost(server.host)
      setPort(String(server.ssh_port))
      setUser(server.ssh_user)
      setMethod(server.auth_method)
      setKeyId(server.ssh_key_id ?? '')
      setGroupId(server.group_id ?? '')
      setRegion(server.region ?? '')
      setTypeKey(server.type_key)
      setSavedOs(server.declared_os)
      setOsFamily(server.declared_os.kind === 'custom' ? 'custom' : server.declared_os.family)
      setOsRelease(server.declared_os.kind === 'catalog' ? server.declared_os.releaseKey : '')
      setOsText(server.declared_os.kind === 'custom' ? server.declared_os.text : '')
      setSavedType({
        key: server.type_key,
        name_i18n: server.type_name_i18n,
        software: server.required_software,
        supportedOs: server.type_supported_os,
      })
      setOriginal({ groupId: server.group_id ?? '', typeKey: server.type_key })
    }
    setServerLoaded(true)
  }
  const authentication = {
    server_id: props.editing ? props.serverId : undefined,
    host: host.trim(),
    ssh_port: Number(port),
    ssh_user: user.trim(),
    auth_method: method,
    ssh_key_id: method === 'private_key' ? keyId : undefined,
    secret: method === 'private_key' && keyId !== '' ? undefined : secret,
  }
  const authenticationKey = JSON.stringify(authentication)
  if (authRevision.current.key !== authenticationKey)
    authRevision.current = { key: authenticationKey, revision: authRevision.current.revision + 1 }
  previews.sync(authRevision.current.revision)
  const currentConnection =
    connection?.revision === authRevision.current.revision && connection.expires_at > Date.now()
      ? connection
      : undefined
  const savedAuthenticationKey = loadedServer
    ? JSON.stringify({
        server_id: props.serverId,
        host: loadedServer.host,
        ssh_port: loadedServer.ssh_port,
        ssh_user: loadedServer.ssh_user,
        auth_method: loadedServer.auth_method,
        ssh_key_id: loadedServer.auth_method === 'private_key' ? (loadedServer.ssh_key_id ?? '') : undefined,
        secret: loadedServer.auth_method === 'private_key' && loadedServer.ssh_key_id ? undefined : '',
      })
    : ''
  const canTest =
    host.trim() !== '' &&
    user.trim() !== '' &&
    Number.isInteger(Number(port)) &&
    Number(port) > 0 &&
    Number(port) <= 65535 &&
    ((method === 'private_key' && keyId !== '') ||
      secret.trim() !== '' ||
      (method === 'password' && authenticationKey === savedAuthenticationKey))

  useEffect(
    () => () => {
      requests.current += 1
      previews.clear()
    },
    [],
  )
  useEffect(() => {
    if (!connection) return
    const timer = setTimeout(() => setConnection(undefined), Math.max(0, connection.expires_at - Date.now()))
    return () => clearTimeout(timer)
  }, [connection])
  const [busy, setBusy] = useState(false)
  const [policies, setPolicies] = useState<SoftwarePolicy[]>([])

  useEffect(() => {
    let stopped = false
    void Promise.all([
      api<GroupDto[]>('/console-api/server-groups'),
      api<KeyDto[]>('/console-api/ssh-keys'),
      api<TypeOptions>('/console-api/server-types'),
    ])
      .then(([nextGroups, nextKeys, nextDefaults]) => {
        if (stopped) return
        setGroups(nextGroups)
        setKeys(nextKeys)
        setDefaults(nextDefaults)
      })
      .catch((cause: unknown) => {
        if (!stopped) setError(requestError(cause))
      })
    return () => {
      stopped = true
    }
  }, [])

  useEffect(() => {
    if (!props.editing || props.serverId === '') return
    let stopped = false
    void api<ServerDto>(`/console-api/servers/${props.serverId}`)
      .then((server) => {
        if (stopped) return
        applyServer(server)
      })
      .catch((cause: unknown) => {
        if (!stopped) setError(requestError(cause))
      })
    return () => {
      stopped = true
    }
  }, [props.editing, props.serverId])

  const family = OS_CATALOG.find((item) => item.key === osFamily)
  const release = family?.releases.find((item) => item.key === osRelease)
  const declaredOs: DeclaredOs | undefined =
    osFamily === 'custom'
      ? osText.trim()
        ? { kind: 'custom', text: osText.trim() }
        : undefined
      : release
        ? {
            kind: 'catalog',
            family: osFamily,
            releaseKey: release.key,
            version: release.version,
            precision: release.precision,
            name: release.name,
          }
        : savedOs?.kind === 'catalog' && savedOs.family === osFamily && savedOs.releaseKey === osRelease
          ? savedOs
          : undefined
  const choices = groupId === '' ? defaults : groups.find((group) => group.id === groupId)
  const applicableTypes =
    declaredOs === undefined ? [] : (choices?.types ?? []).filter((type) => typeSupportsOs(type, declaredOs))
  const selected =
    choices?.types.find((type) => type.key === typeKey) ??
    (savedType?.key === typeKey ? savedType : undefined)
  const originalBinding = original?.groupId === groupId && original.typeKey === typeKey
  const available = choices?.available === true && applicableTypes.some((type) => type.key === typeKey)
  const configuredSoftware = (selected?.software ?? []).filter(
    (item) =>
      !item.whenOs ||
      (declaredOs !== undefined && supportsOs({ kind: 'explicit', selectors: item.whenOs }, declaredOs)),
  )
  const identityKey = JSON.stringify([authRevision.current.revision, groupId, typeKey, declaredOs])
  if (identityRevision.current.key !== identityKey)
    identityRevision.current = { key: identityKey, revision: identityRevision.current.revision + 1 }
  const selection = { groupId, typeKey, os: declaredOs, types: choices?.types ?? [] }
  const identified = currentConnection ? previews.cached(authRevision.current.revision, selection) : undefined
  const savedSystemCurrent =
    loadedServer !== undefined &&
    authenticationKey === savedAuthenticationKey &&
    loadedServer.group_id === (groupId || null) &&
    loadedServer.type_key === typeKey &&
    declaredOs !== undefined &&
    sameDeclaredOs(loadedServer.declared_os, declaredOs)
  const software = identified?.required_software ?? configuredSoftware
  const softwareStatus =
    identified?.software_status ?? (savedSystemCurrent ? loadedServer?.software_status : undefined)
  const architecture =
    identified?.detected_os.architecture ??
    (savedSystemCurrent ? loadedServer?.detected_os?.architecture : undefined)
  const canSave =
    defaults !== undefined &&
    serverLoaded &&
    declaredOs !== undefined &&
    selected !== undefined &&
    (available ||
      (originalBinding &&
        !choices?.available &&
        savedOs !== undefined &&
        sameDeclaredOs(declaredOs, savedOs)))

  const basicDirty =
    loadedServer !== undefined &&
    (name !== loadedServer.name ||
      host !== loadedServer.host ||
      Number(port) !== loadedServer.ssh_port ||
      user !== loadedServer.ssh_user ||
      region !== (loadedServer.region ?? '') ||
      method !== loadedServer.auth_method ||
      keyId !== (loadedServer.ssh_key_id ?? '') ||
      secret.trim() !== '' ||
      declaredOs === undefined ||
      !sameDeclaredOs(declaredOs, loadedServer.declared_os))
  const policiesDirty =
    loadedServer !== undefined &&
    (auto !== loadedServer.install_required_software ||
      JSON.stringify(policies) !== JSON.stringify(loadedServer.software_policies))
  const canSaveBasic = canSave && basicDirty
  const canSavePolicies = serverLoaded && policiesDirty

  useEffect(() => {
    // Editing a field invalidates a previous save or connection error.
    setError(null)
  }, [name, host, port, user, method, keyId, secret, region, groupId, typeKey, osFamily, osRelease, osText, policies, auto])

  useEffect(() => {
    if (!serverLoaded || declaredOs === undefined || typeKey !== '') return
    const defaultType = applicableTypes.find((type) => type.key === defaultTypeForOs(choices, declaredOs))
    if (defaultType !== undefined) setTypeKey(defaultType.key)
  }, [serverLoaded, declaredOs, typeKey, choices, applicableTypes])

  useEffect(() => {
    if (automaticIdentification.current !== identityKey) return
    automaticIdentification.current = undefined
    if (canTest && available && !busy) void identify(false)
  }, [identityKey, canTest, available, busy])

  function queueIdentification(nextGroup: string, nextType: string): void {
    automaticIdentification.current = JSON.stringify([
      authRevision.current.revision,
      nextGroup,
      nextType,
      declaredOs,
    ])
  }

  function changeGroup(id: string): void {
    const next = id === '' ? defaults : groups.find((group) => group.id === id)
    const allowed =
      declaredOs === undefined ? [] : (next?.types ?? []).filter((type) => typeSupportsOs(type, declaredOs))
    const type =
      allowed.find((item) => item.key === typeKey) ??
      allowed.find((item) => item.key === defaultTypeForOs(next, declaredOs))
    if (selected === undefined || type === undefined || !sameSoftware(selected, type)) setAuto(false)
    if (type && (groupId !== id || type.key !== typeKey)) queueIdentification(id, type.key)
    setGroupId(id)
    setTypeKey(type?.key ?? '')
  }

  async function preview(): Promise<void> {
    const request = ++requests.current,
      revision = authRevision.current.revision
    setError(null)
    setConnection(undefined)
    setPending('test')
    try {
      const result = await previews.test(revision, authentication, true)
      if (request === requests.current && revision === authRevision.current.revision)
        setConnection({ ...result, revision })
    } catch (cause) {
      if (request === requests.current && revision === authRevision.current.revision)
        setError(requestError(cause))
    } finally {
      if (request === requests.current) setPending(null)
    }
  }

  async function identify(force = true): Promise<void> {
    if (!canTest || (force && !currentConnection)) return
    const request = ++requests.current,
      revision = authRevision.current.revision,
      scope = identityRevision.current.revision
    setPending(currentConnection ? 'identify' : 'test')
    setError(null)
    try {
      const connection = await previews.test(revision, authentication)
      if (
        request !== requests.current ||
        revision !== authRevision.current.revision ||
        scope !== identityRevision.current.revision
      )
        return
      setConnection({ ...connection, revision })
      setPending('identify')
      const preview = await previews.identify(revision, authentication, selection, force)
      if (
        request !== requests.current ||
        revision !== authRevision.current.revision ||
        scope !== identityRevision.current.revision
      )
        return
      const result = preview.identification
      setConnection({ ...preview.connection, revision })
      setCachedIdentification(preview.cached)
      const os = result.declared_os
      setSavedOs(os)
      setOsFamily(os.kind === 'custom' ? 'custom' : os.family)
      setOsRelease(os.kind === 'catalog' ? os.releaseKey : '')
      setOsText(os.kind === 'custom' ? os.text : '')
      if (result.type_key !== typeKey) setAuto(false)
      setTypeKey(result.type_key)
    } catch (cause) {
      if (
        request === requests.current &&
        revision === authRevision.current.revision &&
        scope === identityRevision.current.revision
      ) {
        const error = requestError(cause)
        setError(error)
        if (
          error.code === 'connection_test_required' ||
          error.code === 'fingerprint_mismatch' ||
          error.code.startsWith('ssh_')
        )
          setConnection(undefined)
      }
    } finally {
      if (request === requests.current) setPending(null)
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSave || busy || pending !== null) return
    setBusy(true)
    setError(null)
    try {
      let nextKey = keyId
      if (method === 'private_key' && keyId === '' && secret.trim() !== '') {
        const created = await api<KeyDto>('/console-api/ssh-keys', {
          method: 'POST',
          body: JSON.stringify({ name: keyName.trim() || name.trim(), secret }),
        })
        nextKey = created.id
      }
      const body = {
        name: name.trim(),
        host: host.trim(),
        ssh_port: Number(port),
        ssh_user: user.trim(),
        auth_method: method,
        group_id: groupId === '' ? null : groupId,
        type_key: typeKey,
        declared_os: declaredOs,
        region,
        install_required_software: software.length > 0 && auto,
        software_policies: software.map(
          (s) =>
            policies.find((p) => p.software_key === s.software_key) ?? {
              software_key: s.software_key,
              restriction: { kind: 'any' },
              detect_updates: false,
            },
        ),
        inspect_after_save: identified !== undefined,
        ssh_key_id: method === 'private_key' ? nextKey : undefined,
        secret: method === 'password' && secret.trim() !== '' ? secret : undefined,
      }
      const saved = props.editing
        ? await api<ServerDto>(`/console-api/servers/${props.serverId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await api<ServerDto>('/console-api/servers', { method: 'POST', body: JSON.stringify(body) })
      props.onDone(saved.id)
    } catch (cause) {
      setError(requestError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function saveBasic(): Promise<void> {
    if (!canSaveBasic || busy || pending !== null) return
    setBusy(true)
    setError(null)
    try {
      let nextKey = keyId
      if (method === 'private_key' && keyId === '' && secret.trim() !== '') {
        const created = await api<KeyDto>('/console-api/ssh-keys', {
          method: 'POST',
          body: JSON.stringify({ name: keyName.trim() || name.trim(), secret }),
        })
        nextKey = created.id
      }
      const saved = await api<ServerDto>(`/console-api/servers/${props.serverId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          host: host.trim(),
          ssh_port: Number(port),
          ssh_user: user.trim(),
          auth_method: method,
          declared_os: declaredOs,
          region,
          inspect_after_save: identified !== undefined,
          ssh_key_id: method === 'private_key' ? nextKey : undefined,
          secret: method === 'password' && secret.trim() !== '' ? secret : undefined,
        }),
      })
      applyServer(saved, { policies: !policiesDirty })
      props.onSaved?.(saved)
    } catch (cause) {
      setError(requestError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function savePolicies(): Promise<void> {
    if (!canSavePolicies || busy || pending !== null) return
    setBusy(true)
    setError(null)
    try {
      const saved = await api<ServerDto>(`/console-api/servers/${props.serverId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          install_required_software: software.length > 0 && auto,
          software_policies: software.map(
            (item) =>
              policies.find((policy) => policy.software_key === item.software_key) ?? {
                software_key: item.software_key,
                restriction: { kind: 'any' },
                detect_updates: false,
              },
          ),
        }),
      })
      applyServer(saved, { basic: !basicDirty })
      props.onSaved?.(saved)
    } catch (cause) {
      setError(requestError(cause))
    } finally {
      setBusy(false)
    }
  }

  return {
    active,
    applicableTypes,
    architecture,
    auto,
    available,
    busy,
    cachedIdentification,
    basicDirty,
    canSave,
    canSaveBasic,
    canSavePolicies,
    canTest,
    changeGroup,
    choices,
    configuredSoftware,
    copy,
    currentConnection,
    declaredOs,
    error,
    family,
    groupId,
    groups,
    host,
    identified,
    identify,
    keyId,
    keyName,
    keys,
    loadedServer,
    method,
    name,
    original,
    osFamily,
    osRelease,
    osText,
    pending,
    policies,
    port,
    preview,
    queueIdentification,
    region,
    policiesDirty,
    save,
    saveBasic,
    savePolicies,
    savedOs,
    secret,
    selected,
    setAuto,
    setHost,
    setKeyId,
    setKeyName,
    setMethod,
    setName,
    setOsFamily,
    setOsRelease,
    setOsText,
    setPolicies,
    setPort,
    setRegion,
    setSecret,
    setTypeKey,
    setUser,
    software,
    softwareStatus,
    typeKey,
    user,
  }
}
export type ServerFormModel = ReturnType<typeof useServerForm>
