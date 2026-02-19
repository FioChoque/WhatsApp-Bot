process.on('unhandledRejection', r =>
  console.log('⚠️ Unhandled Rejection:', r?.message || r)
);

const express = require('express');
const multer = require('multer');
const path = require('path');
const wppconnect = require('@wppconnect-team/wppconnect');
const mysql = require('mysql2/promise');
const fs = require('fs').promises;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/media', express.static(path.join(__dirname, 'media')));

// ===== MYSQL =====
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'whatsaap_bd'
});

// ===== UPLOAD =====
const upload = multer({ dest: 'uploads/' });

// ===== UTILS =====
const delay = ms => new Promise(res => setTimeout(res, ms));

// ===== EMOJIS =====
const emojis = ['😊','👍','👋','✨','📌','🙌','🙂','😉','🤝','📢'];
const emojiRandom = () =>
  emojis[Math.floor(Math.random() * emojis.length)];

// ===== CONFIG ENVÍO =====
const MENSAJES_POR_LOTE = 50;
const PAUSA_ENTRE_LOTES = 15 * 60 * 1000; // 15 minutos
const PAUSA_ENTRE_MENSAJES = () => 800 + Math.random() * 400;
const PAUSA_ARCHIVOS = () => 4000 + Math.random() * 2000;

let client;

// fuerza apertura de chat
const openChat = async (number) => {
  const chatId = number + '@c.us';
  try {
    await client.getChatById(chatId);
  } catch {
    try { await client.sendSeen(chatId); } catch {}
  }
};

// ===== VAR =====
let qrText = null;
let waStatus = 'Conectando...';

// ===== SISTEMA DE HISTORIAL MEJORADO =====
let sendStatus = { 
  active: false, 
  currentBatch: 0,
  totalBatches: 0,
  currentContact: { number: '', name: '', index: 0, total: 0 },
  currentFile: { name: '', type: '', progress: 0, current: 0, total: 0 },
  status: '',
  detailedStatus: '',
  startTime: null,
  estimatedTimeRemaining: null,
  completedContacts: 0,
  failedContacts: 0,
  pendingContacts: 0
};

let sendHistory = [];
const MAX_HISTORY = 100;

// ===== FUNCIONES DE REGISTRO MEJORADAS =====
function addToHistory(entry) {
  if (!entry || typeof entry !== 'object') {
    console.log('⚠️ Intento de agregar entrada inválida al historial');
    return null;
  }

  const historyEntry = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    type: entry.type || 'info',
    message: entry.message || '',
    ...entry
  };
  
  sendHistory.unshift(historyEntry);
  
  if (sendHistory.length > MAX_HISTORY) {
    sendHistory = sendHistory.slice(0, MAX_HISTORY);
  }
  
  return historyEntry;
}

function updateSendStatus(updates) {
  sendStatus = { ...sendStatus, ...updates };
  
  if (updates.status && updates.status !== sendStatus.status) {
    addToHistory({
      type: 'status_change',
      status: updates.status,
      detailedStatus: updates.detailedStatus || sendStatus.detailedStatus,
      contact: updates.currentContact?.number || sendStatus.currentContact.number
    });
  }
}

function calculateProgress(completed, total) {
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

function estimateTimeRemaining(startTime, completed, total) {
  if (!startTime || completed === 0) return null;
  
  const elapsed = Date.now() - startTime;
  const rate = completed / elapsed;
  const remaining = total - completed;
  
  if (rate <= 0) return null;
  
  const estimatedMs = remaining / rate;
  
  if (estimatedMs < 60000) {
    return `${Math.ceil(estimatedMs / 1000)} segundos`;
  } else if (estimatedMs < 3600000) {
    return `${Math.ceil(estimatedMs / 60000)} minutos`;
  } else {
    const hours = Math.floor(estimatedMs / 3600000);
    const minutes = Math.ceil((estimatedMs % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}

// ===== WPP =====
wppconnect.create({
  session: 'auto-send-session',
  sessionPath: './tokens',
  puppeteerOptions:{ headless:true, args:['--no-sandbox'] },
  catchQR: qr => {
    qrText = qr;
    waStatus = 'Escanea QR';
    addToHistory({
      type: 'connection',
      status: 'QR_REQUIRED',
      message: 'Código QR generado. Escanea con WhatsApp.'
    });
  }
})
.then(c => {
  client = c;
  waStatus = 'Conectado';
  qrText = null;
  addToHistory({
    type: 'connection',
    status: 'CONNECTED',
    message: 'WhatsApp conectado exitosamente'
  });
})
.catch(e => {
  console.log('WPP ERROR:', e);
  addToHistory({
    type: 'error',
    error: 'WPP_CONNECTION_ERROR',
    message: e.message,
    stack: e.stack
  });
});

// ===== ENDPOINTS =====
app.get('/status', (req,res)=>res.json({ qr:qrText, status:waStatus }));

app.get('/send-status', (req,res)=>res.json({ 
  current: sendStatus, 
  history: sendHistory 
}));

app.get('/contacts', async (req, res) => {
  const estado = req.query.estado || 'todos';
  const citaFilter = req.query.cita || '';
  let sql = `SELECT nombre, telefono, estado, fecha_cita FROM adherentes WHERE telefono IS NOT NULL`;
  let params = [];

  if (estado !== 'todos') {
    sql += ' AND estado = ?';
    params.push(estado);
  }

  try {
    const [rows] = await db.query(sql, params);

    let filteredRows = rows;
    if (citaFilter) {
      const now = new Date();
      filteredRows = rows.filter(r => {
        if (!r.fecha_cita) return false;
        const diff = (new Date(r.fecha_cita) - now) / 36e5;
        if (citaFilter === '24h') return diff > 0 && diff <= 24;
        if (citaFilter === '3h') return diff > 0 && diff <= 3;
        return true;
      });
    }

    res.json(filteredRows.map(r => ({
      name: r.nombre,
      number: r.telefono.replace(/\D/g,''),
      estado: r.estado,
      fecha_cita: r.fecha_cita,
      horas_restantes: r.fecha_cita ? 
        Math.round((new Date(r.fecha_cita) - new Date()) / 36e5 * 10) / 10 : null
    })));
  } catch (error) {
    addToHistory({
      type: 'error',
      error: 'DB_QUERY_ERROR',
      message: error.message
    });
    res.status(500).json({ error: 'Error al cargar contactos' });
  }
});

app.get('/mensaje-semana/:s', async (req,res)=>{
  try {
    const [r] = await db.query(
      `SELECT mensaje FROM mensajes_semanales WHERE semana=? AND activo=1 LIMIT 1`,
      [req.params.s]
    );
    res.json({ mensaje: r[0]?.mensaje || null });
  } catch (error) {
    addToHistory({
      type: 'error',
      error: 'DB_QUERY_ERROR',
      message: error.message
    });
    res.status(500).json({ error: 'Error al cargar mensaje' });
  }
});

app.get('/archivos-semana/:s', async (req,res)=>{
  try {
    const [r] = await db.query(
      `SELECT nombre_original, ruta, tipo
       FROM archivos_semanales
       WHERE semana=? AND activo=1`,
      [req.params.s]
    );
    res.json(r);
  } catch (error) {
    addToHistory({
      type: 'error',
      error: 'DB_QUERY_ERROR',
      message: error.message
    });
    res.status(500).json({ error: 'Error al cargar archivos' });
  }
});

app.post('/clear-history', (req, res) => {
  sendHistory = [];
  
  addToHistory({
    type: 'system',
    action: 'CLEAR_HISTORY',
    message: 'Historial limpiado manualmente'
  });
  
  console.log('🧹 Historial limpiado correctamente');
  res.json({ 
    success: true, 
    message: 'Historial limpiado',
    history: sendHistory 
  });
});

// ===== ENVÍO MEJORADO CON MEJOR TRACKING =====
app.post('/send', upload.array('files',50), async (req,res)=>{
  if(!client) {
    addToHistory({
      type: 'error',
      error: 'CLIENT_NOT_READY',
      message: 'WhatsApp no está listo'
    });
    return res.status(503).send('WhatsApp no listo');
  }

  const contacts = JSON.parse(req.body.selectedContacts || '[]');
  const autoFiles = JSON.parse(req.body.autoFiles || '[]');
  const mensajeSemana = req.body.message || '';

  if (contacts.length === 0) {
    addToHistory({
      type: 'warning',
      message: 'Intento de envío sin contactos seleccionados'
    });
    return res.status(400).send('No hay contactos seleccionados');
  }

  const contactsInfo = [];
  for (const telefono of contacts) {
    try {
      const [r] = await db.query(
        'SELECT nombre, estado FROM adherentes WHERE telefono LIKE ? LIMIT 1',
        ['%' + telefono]
      );
      contactsInfo.push({
        number: telefono,
        name: r[0]?.nombre || 'Desconocido',
        estado: r[0]?.estado || 'desconocido'
      });
    } catch (error) {
      contactsInfo.push({
        number: telefono,
        name: 'Error',
        estado: 'error'
      });
    }
  }

  const [extra] = await db.query(`
    SELECT mensaje FROM mensajes_semanales
    WHERE tipo='no_adherente' AND activo=1 LIMIT 1
  `);
  const mensajeExtra = extra[0]?.mensaje || '';

  const totalContacts = contacts.length;
  const totalBatches = Math.ceil(totalContacts / MENSAJES_POR_LOTE);
  const startTime = Date.now();

  updateSendStatus({
    active: true,
    currentBatch: 1,
    totalBatches: totalBatches,
    currentContact: { number: '', name: '', index: 0, total: totalContacts },
    currentFile: { name: '', type: '', progress: 0 },
    status: 'INICIANDO',
    detailedStatus: 'Preparando envío...',
    startTime: startTime,
    estimatedTimeRemaining: null,
    completedContacts: 0,
    failedContacts: 0,
    pendingContacts: totalContacts
  });

  addToHistory({
    type: 'send_start',
    totalContacts: totalContacts,
    totalBatches: totalBatches,
    hasFiles: autoFiles.length > 0 || req.files.length > 0,
    filesCount: autoFiles.length + req.files.length,
    message: `Iniciando envío a ${totalContacts} contactos en ${totalBatches} lotes`
  });

  let contador = 0;
  let completados = 0;
  let fallidos = 0;

  for (let i = 0; i < contacts.length; i++) {
    const telefono = contacts[i];
    const contactInfo = contactsInfo[i];
    
    contador++;
    const batchNumber = Math.ceil(contador / MENSAJES_POR_LOTE);

    if (contador > 1 && contador % MENSAJES_POR_LOTE === 0) {
      updateSendStatus({
        status: 'PAUSA_PROGRAMADA',
        detailedStatus: `Pausa de seguridad de 15 minutos después del lote ${batchNumber-1}`,
        currentBatch: batchNumber
      });
      
      addToHistory({
        type: 'batch_pause',
        batch: batchNumber - 1,
        duration: '15 minutos',
        message: `Pausa programada de 15 minutos después del lote ${batchNumber - 1}`
      });
      
      console.log(`⏸ Pausa de seguridad 15 minutos (lote ${batchNumber-1} completado)...`);
      await delay(PAUSA_ENTRE_LOTES);
      
      updateSendStatus({
        status: 'REANUDANDO',
        detailedStatus: `Reanudando envío - Lote ${batchNumber}`,
        currentBatch: batchNumber
      });
    }

    updateSendStatus({
      currentContact: { 
        number: telefono, 
        name: contactInfo.name,
        index: i + 1, 
        total: totalContacts 
      },
      status: 'ENVIANDO',
      detailedStatus: `Contacto ${i + 1} de ${totalContacts}: ${contactInfo.name} (${contactInfo.estado})`,
      estimatedTimeRemaining: estimateTimeRemaining(startTime, completados + fallidos, totalContacts)
    });

    try {
      const estado = contactInfo.estado.toLowerCase().trim();
      const nombre = contactInfo.name;

      let mensajeFinal = `Hola ${nombre},\n\n${mensajeSemana}`;
      if (estado === 'no adherente' && mensajeExtra) {
        mensajeFinal += '\n\n' + mensajeExtra;
      }
      mensajeFinal += ' ' + emojiRandom();

      if (autoFiles.length === 0 && req.files.length === 0) {

        updateSendStatus({
          currentFile: { name: 'Solo texto', type: 'text', progress: 50 },
          detailedStatus: `Enviando texto a ${nombre}...`
        });

        try {
          await openChat(telefono);
          await delay(300);
          await client.sendText(telefono + '@c.us', mensajeFinal);
          
          completados++;
          updateSendStatus({
            completedContacts: completados,
            pendingContacts: totalContacts - completados - fallidos,
            currentFile: { name: 'Solo texto', type: 'text', progress: 100 }
          });

          addToHistory({
            type: 'send_success',
            contact: telefono,
            name: nombre,
            estado: estado,
            method: 'text',
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          fallidos++;
          updateSendStatus({ failedContacts: fallidos });
          
          addToHistory({
            type: 'send_error',
            contact: telefono,
            name: nombre,
            estado: estado,
            error: error.message,
            method: 'text'
          });
        }

        await delay(PAUSA_ENTRE_MENSAJES());
        continue;
      }

      for (let j = 0; j < autoFiles.length; j++) {
        const f = autoFiles[j];
        
        updateSendStatus({
          currentFile: { 
            name: f.nombre_original, 
            type: f.tipo, 
            progress: Math.round((j / autoFiles.length) * 100),
            current: j + 1,
            total: autoFiles.length
          },
          detailedStatus: `Enviando archivo ${j + 1}/${autoFiles.length} a ${nombre}: ${f.nombre_original}`
        });

        try {
          await openChat(telefono);
          await delay(500);
          
          try {
            await fs.access(f.ruta);
          } catch {
            throw new Error(`Archivo no encontrado: ${f.ruta}`);
          }
          
          await client.sendFile(
            telefono + '@c.us',
            path.resolve(f.ruta),
            f.nombre_original,
            j === 0 ? mensajeFinal : ''
          );

          addToHistory({
            type: 'file_sent',
            contact: telefono,
            name: nombre,
            file: f.nombre_original,
            fileType: f.tipo,
            fileIndex: j + 1,
            totalFiles: autoFiles.length
          });

        } catch (error) {
          addToHistory({
            type: 'file_error',
            contact: telefono,
            name: nombre,
            file: f.nombre_original,
            error: error.message
          });
        }

        await delay(PAUSA_ARCHIVOS());
      }

      if (req.files && req.files.length > 0) {
        const totalManualFiles = autoFiles.length + req.files.length;
        
        for (let j = 0; j < req.files.length; j++) {
          const f = req.files[j];
          const fileIndex = autoFiles.length + j + 1;
          
          updateSendStatus({
            currentFile: { 
              name: f.originalname, 
              type: 'manual', 
              progress: Math.round((fileIndex / totalManualFiles) * 100),
              current: fileIndex,
              total: totalManualFiles
            },
            detailedStatus: `Enviando archivo manual ${fileIndex}/${totalManualFiles} a ${nombre}: ${f.originalname}`
          });

          try {
            await openChat(telefono);
            await delay(500);
            
            await client.sendFile(
              telefono + '@c.us',
              path.resolve(f.path),
              f.originalname,
              fileIndex === 1 ? mensajeFinal : ''
            );

            addToHistory({
              type: 'manual_file_sent',
              contact: telefono,
              name: nombre,
              file: f.originalname,
              fileIndex: fileIndex,
              totalFiles: totalManualFiles
            });

            try {
              await fs.unlink(f.path);
            } catch (cleanupError) {
              console.log('Error limpiando archivo temporal:', cleanupError.message);
            }

          } catch (error) {
            addToHistory({
              type: 'manual_file_error',
              contact: telefono,
              name: nombre,
              file: f.originalname,
              error: error.message
            });
          }

          await delay(PAUSA_ARCHIVOS());
        }
      }

      if (!sendStatus.currentContact.number.includes('error')) {
        completados++;
        updateSendStatus({ completedContacts: completados });
      }

    } catch (error) {
      fallidos++;
      updateSendStatus({ failedContacts: fallidos });
      
      addToHistory({
        type: 'contact_error',
        contact: telefono,
        name: contactInfo.name,
        error: error.message,
        stack: error.stack
      });
    }
  }

  const endTime = Date.now();
  const totalTime = Math.round((endTime - startTime) / 1000);
  
  updateSendStatus({
    active: false,
    status: 'COMPLETADO',
    detailedStatus: `Envío completado: ${completados} exitosos, ${fallidos} fallidos en ${totalTime} segundos`,
    completedContacts: completados,
    failedContacts: fallidos,
    pendingContacts: 0,
    estimatedTimeRemaining: null
  });

  addToHistory({
    type: 'send_complete',
    totalContacts: totalContacts,
    completed: completados,
    failed: fallidos,
    totalTime: totalTime,
    message: `Envío completado: ${completados} exitosos, ${fallidos} fallidos en ${totalTime} segundos`
  });

  res.json({ 
    message: 'Envío completado',
    stats: {
      total: totalContacts,
      completados: completados,
      fallidos: fallidos,
      tiempoSegundos: totalTime
    }
  });
});

app.get('/stats', async (req, res) => {
  try {
    const [totalContacts] = await db.query('SELECT COUNT(*) as total FROM adherentes WHERE telefono IS NOT NULL');
    const [adherentes] = await db.query("SELECT COUNT(*) as total FROM adherentes WHERE estado = 'adherente'");
    const [noAdherentes] = await db.query("SELECT COUNT(*) as total FROM adherentes WHERE estado = 'no adherente'");
    
    const today = new Date().toISOString().split('T')[0];
    const todaySends = sendHistory.filter(h => 
      h.timestamp && h.timestamp.startsWith(today) && h.type === 'send_success'
    ).length;
    
    res.json({
      database: {
        total: totalContacts[0].total,
        adherentes: adherentes[0].total,
        noAdherentes: noAdherentes[0].total
      },
      sessions: {
        todaySends: todaySends,
        totalHistory: sendHistory.length,
        lastSend: sendHistory[0] || null
      },
      currentStatus: sendStatus
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== SERVER =====
app.use(express.static(__dirname));
app.listen(3000, ()=> {
  console.log('🚀 http://localhost:3000');
  addToHistory({
    type: 'system',
    action: 'SERVER_START',
    message: 'Servidor iniciado en http://localhost:3000'
  });
});